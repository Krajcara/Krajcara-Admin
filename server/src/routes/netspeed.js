'use strict';
const express  = require('express');
const router   = express.Router();
const { exec } = require('child_process');
const db       = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

let testRunning = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcStats(values) {
  const valid = values.filter(v => v != null && !isNaN(v) && v > 0);
  if (!valid.length) return { min: null, avg: null, max: null };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return {
    min: Math.round(min * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    max: Math.round(max * 10) / 10,
  };
}

function runFastCli() {
  return new Promise((resolve, reject) => {
    // fast-cli with --upload flag and JSON output
    // fast --upload --json outputs: {"downloadSpeed":X,"uploadSpeed":Y,"ping":Z,"downloaded":N,"latency":M,"bufferBloat":B,"userLocation":"...","userIp":"..."}
    const fastBin = process.env.FAST_CLI_PATH || 'fast';
    const cmd = `${fastBin} --upload --json`;

    exec(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return reject(new Error(`fast-cli failed: ${err.message}`));
      }

      const raw = (stdout || '').trim();
      if (!raw) return reject(new Error('fast-cli returned no output'));

      try {
        // fast --json can return multiple JSON objects or a single one
        // Try to parse the last complete JSON object
        const jsonMatches = raw.match(/\{[^{}]+\}/g);
        if (!jsonMatches?.length) throw new Error('No JSON in output');

        // Use the last (most complete) result
        const data = JSON.parse(jsonMatches[jsonMatches.length - 1]);

        const download = parseFloat(data.downloadSpeed) || null;
        const upload   = parseFloat(data.uploadSpeed)   || null;
        const ping     = parseFloat(data.latency || data.ping) || null;

        if (!download) throw new Error('Could not parse download speed');

        resolve({ download, upload, ping, server: data.userLocation || 'fast.com' });
      } catch (parseErr) {
        // Fallback: try to parse plain text output
        // fast plain text: "X Mbps\nX Mbps upload"
        const dlMatch  = raw.match(/^([\d.]+)\s*Mbps/im);
        const ulMatch  = raw.match(/^([\d.]+)\s*Mbps\s+upload/im);
        const download = dlMatch ? parseFloat(dlMatch[1]) : null;
        const upload   = ulMatch ? parseFloat(ulMatch[1]) : null;
        if (!download) return reject(new Error('Could not parse fast-cli output: ' + raw.slice(0, 200)));
        resolve({ download, upload, ping: null, server: 'fast.com' });
      }
    });
  });
}

async function executeTest(triggeredBy = 'manual') {
  if (testRunning) throw new Error('A test is already running');
  testRunning = true;

  // Insert a 'running' row so UI can show progress
  const row = db.prepare(
    "INSERT INTO speed_tests (status, triggered_by, created_at) VALUES ('running', ?, datetime('now'))"
  ).run(triggeredBy);
  const id = row.lastInsertRowid;

  const io = global.io;
  if (io) io.emit('netspeed:started', { id });

  try {
    const result = await runFastCli();

    db.prepare(`
      UPDATE speed_tests SET status='done', download=?, upload=?, ping=?, server=? WHERE id=?
    `).run(result.download, result.upload ?? null, result.ping ?? null, result.server, id);

    const saved = db.prepare('SELECT * FROM speed_tests WHERE id = ?').get(id);
    if (io) io.emit('netspeed:done', { test: saved });
    return saved;
  } catch (err) {
    db.prepare("UPDATE speed_tests SET status='error', error=? WHERE id=?").run(err.message, id);
    if (io) io.emit('netspeed:error', { id, error: err.message });
    throw err;
  } finally {
    testRunning = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/netspeed/tests?limit=N
router.get('/tests', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const tests = db.prepare(
    'SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  res.json(tests);
});

// GET /api/netspeed/stats — min/avg/max for download, upload, ping
router.get('/stats', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000)
    .toISOString().replace('T', ' ').substring(0, 19);

  const tests = db.prepare(
    "SELECT download, upload, ping FROM speed_tests WHERE status='done' AND created_at >= ? ORDER BY created_at DESC"
  ).all(since);

  res.json({
    days,
    count: tests.length,
    download: calcStats(tests.map(t => t.download)),
    upload:   calcStats(tests.map(t => t.upload)),
    ping:     calcStats(tests.map(t => t.ping)),
  });
});

// GET /api/netspeed/status
router.get('/status', (req, res) => {
  const latest = db.prepare("SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT 1").get();
  res.json({
    running:    testRunning,
    last_test:  latest || null,
  });
});

// POST /api/netspeed/run
router.post('/run', requireRole('superadmin', 'admin', 'operator'), async (req, res) => {
  if (testRunning) return res.status(409).json({ error: 'A test is already running' });

  // Respond immediately, test runs in background
  res.json({ ok: true, message: 'Speed test started' });

  try {
    await executeTest('manual');
  } catch (err) {
    console.error('[NetSpeed] Test error:', err.message);
  }
});

// DELETE /api/netspeed/tests/:id
router.delete('/tests/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM speed_tests WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'netspeed', entityId: req.params.id, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// Scheduled auto-run (called from scheduler.js)
async function runScheduledTest() {
  try {
    await executeTest('auto');
    console.log('[NetSpeed] Scheduled test complete');
  } catch (err) {
    console.error('[NetSpeed] Scheduled test error:', err.message);
  }
}

module.exports = { router, runScheduledTest };
