'use strict';
const express  = require('express');
const router   = express.Router();
const { exec } = require('child_process');
const https    = require('https');
const http     = require('http');
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

// ── Ping test ─────────────────────────────────────────────────────────────────
function measurePing(host = 'cloudflare.com', count = 5) {
  return new Promise(resolve => {
    exec(`ping -c ${count} -W 3 ${host}`, { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      const match = stdout.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
      resolve(match ? parseFloat(match[2]) : null); // return avg
    });
  });
}

// ── Download test — curl from Cloudflare speed test ───────────────────────────
function measureDownload() {
  return new Promise((resolve) => {
    // Use Cloudflare's speed test endpoint — 100MB file, no auth needed
    const urls = [
      'https://speed.cloudflare.com/__down?bytes=25000000',  // 25MB
      'http://proof.ovh.net/files/10Mb.dat',
    ];

    let tried = 0;

    function tryUrl(url) {
      if (tried >= urls.length) return resolve(null);
      const u = urls[tried++];
      const start   = Date.now();
      let   bytes   = 0;
      const proto   = u.startsWith('https') ? https : http;

      const req = proto.get(u, { timeout: 30000, headers: { 'User-Agent': 'curl/7.68.0' } }, (res) => {
        if (res.statusCode !== 200) { req.destroy(); return tryUrl(); }
        res.on('data', chunk => { bytes += chunk.length; });
        res.on('end', () => {
          const elapsed = (Date.now() - start) / 1000; // seconds
          if (elapsed < 0.5 || bytes < 1000) return tryUrl();
          const mbps = Math.round(((bytes * 8) / elapsed / 1_000_000) * 10) / 10;
          resolve(mbps);
        });
        res.on('error', () => tryUrl());
      });
      req.setTimeout(30000, () => { req.destroy(); tryUrl(); });
      req.on('error', () => tryUrl());
    }

    tryUrl(urls[0]);
  });
}

// ── Upload test — POST data to Cloudflare ─────────────────────────────────────
function measureUpload() {
  return new Promise((resolve) => {
    const SIZE   = 5 * 1024 * 1024; // 5 MB
    const data   = Buffer.alloc(SIZE, 'x');
    const start  = Date.now();

    const options = {
      hostname: 'speed.cloudflare.com',
      path:     '/__up',
      method:   'POST',
      timeout:  30000,
      headers: {
        'Content-Type':   'application/octet-stream',
        'Content-Length': SIZE,
        'User-Agent':     'curl/7.68.0',
      },
    };

    const req = https.request(options, (res) => {
      res.resume(); // drain response
      res.on('end', () => {
        const elapsed = (Date.now() - start) / 1000;
        if (elapsed < 0.2) return resolve(null);
        const mbps = Math.round(((SIZE * 8) / elapsed / 1_000_000) * 10) / 10;
        resolve(mbps);
      });
    });

    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

// ── Run full speed test ───────────────────────────────────────────────────────
async function runSpeedTest() {
  // Run ping, download, upload in sequence
  const ping     = await measurePing('cloudflare.com', 5);
  const download = await measureDownload();
  const upload   = await measureUpload();

  if (!download) throw new Error('Download test failed — check internet connectivity');

  return {
    download,
    upload:  upload || null,
    ping:    ping   || null,
    server:  'Cloudflare speed.cloudflare.com',
  };
}

// ── Execute and persist ───────────────────────────────────────────────────────
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
    const result = await runSpeedTest();
    db.prepare(
      "UPDATE speed_tests SET status='done', download=?, upload=?, ping=?, server=? WHERE id=?"
    ).run(result.download, result.upload, result.ping, result.server, id);

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

router.get('/tests', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json(db.prepare('SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT ?').all(limit));
});

router.get('/stats', (req, res) => {
  const days  = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000)
    .toISOString().replace('T', ' ').substring(0, 19);
  const tests = db.prepare(
    "SELECT download, upload, ping FROM speed_tests WHERE status='done' AND created_at >= ?"
  ).all(since);
  res.json({
    days, count: tests.length,
    download: calcStats(tests.map(t => t.download)),
    upload:   calcStats(tests.map(t => t.upload)),
    ping:     calcStats(tests.map(t => t.ping)),
  });
});

router.get('/status', (req, res) => {
  const latest = db.prepare('SELECT * FROM speed_tests ORDER BY created_at DESC LIMIT 1').get();
  res.json({ running: testRunning, last_test: latest || null });
});

router.post('/run', requireRole('superadmin', 'admin', 'operator'), async (req, res) => {
  if (testRunning) return res.status(409).json({ error: 'A test is already running' });
  res.json({ ok: true, message: 'Speed test started' });
  try { await executeTest('manual'); }
  catch (err) { console.error('[NetSpeed] Test error:', err.message); }
});

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
