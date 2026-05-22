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
  return {
    min: Math.round(Math.min(...valid) * 10) / 10,
    avg: Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10,
    max: Math.round(Math.max(...valid) * 10) / 10,
  };
}

function findSpeedtest() {
  const { execSync } = require('child_process');
  const candidates = [
    '/usr/bin/speedtest',
    '/usr/local/bin/speedtest',
    '/usr/bin/speedtest-cli',
    '/usr/local/bin/speedtest-cli',
  ];
  for (const p of candidates) {
    try { execSync(`test -x ${p}`, { timeout: 1000 }); return p; } catch {}
  }
  try {
    const found = execSync('which speedtest || which speedtest-cli 2>/dev/null', { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (found) return found;
  } catch {}
  return null;
}

function runSpeedtest() {
  return new Promise((resolve, reject) => {
    const bin = findSpeedtest();
    if (!bin) {
      return reject(new Error(
        'speedtest not found. Install: sudo apt-get install -y speedtest-cli'
      ));
    }

    // --json gives structured output with download/upload in bits/s and ping in ms
    exec(`${bin} --json --timeout 60`, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return reject(new Error(`speedtest-cli failed: ${err.message}`));
      }

      const raw = (stdout || '').trim();
      if (!raw) return reject(new Error('speedtest-cli returned no output'));

      try {
        const data = JSON.parse(raw);
        // speedtest-cli returns bits/s — convert to Mbps
        const download = data.download ? Math.round((data.download / 1_000_000) * 10) / 10 : null;
        const upload   = data.upload   ? Math.round((data.upload   / 1_000_000) * 10) / 10 : null;
        const ping     = data.ping     ? Math.round(data.ping * 10) / 10 : null;
        const server   = data.server   ? `${data.server.name}, ${data.server.country}` : 'Ookla';
        if (!download) throw new Error('Could not parse download speed');
        resolve({ download, upload, ping, server });
      } catch (parseErr) {
        reject(new Error('Could not parse speedtest output: ' + raw.slice(0, 200)));
      }
    });
  });
}

async function executeTest(triggeredBy = 'manual') {
  if (testRunning) throw new Error('A test is already running');
  testRunning = true;

  const row = db.prepare(
    "INSERT INTO speed_tests (status, triggered_by, created_at) VALUES ('running', ?, datetime('now'))"
  ).run(triggeredBy);
  const id = row.lastInsertRowid;

  const io = global.io;
  if (io) io.emit('netspeed:started', { id });

  try {
    const result = await runSpeedtest();
    db.prepare(
      "UPDATE speed_tests SET status='done', download=?, upload=?, ping=?, server=? WHERE id=?"
    ).run(result.download, result.upload ?? null, result.ping ?? null, result.server, id);

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

// GET /api/netspeed/stats?days=30
router.get('/stats', (req, res) => {
  const days  = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000)
    .toISOString().replace('T', ' ').substring(0, 19);
  const tests = db.prepare(
    "SELECT download, upload, ping FROM speed_tests WHERE status='done' AND created_at >= ?"
  ).all(since);
  res.json({
    days,
    count:    tests.length,
    download: calcStats(tests.map(t => t.download)),
    upload:   calcStats(tests.map(t => t.upload)),
    ping:     calcStats(tests.map(t => t.ping)),
  });
});

// GET /api/netspeed/status
router.get('/status', (req, res) => {
  const latest = db.prepare('SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT 1').get();
  res.json({ running: testRunning, last_test: latest || null });
});

// POST /api/netspeed/run
router.post('/run', requireRole('superadmin', 'admin', 'operator'), async (req, res) => {
  if (testRunning) return res.status(409).json({ error: 'A test is already running' });
  res.json({ ok: true, message: 'Speed test started' });
  try { await executeTest('manual'); }
  catch (err) { console.error('[NetSpeed] Test error:', err.message); }
});

// DELETE /api/netspeed/tests/:id
router.delete('/tests/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM speed_tests WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'netspeed', entityId: req.params.id, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

async function runScheduledTest() {
  try { await executeTest('auto'); console.log('[NetSpeed] Scheduled test complete'); }
  catch (err) { console.error('[NetSpeed] Scheduled test error:', err.message); }
}

module.exports = { router, runScheduledTest };
