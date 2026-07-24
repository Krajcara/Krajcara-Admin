'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { executeScript, getMetrics, getProcesses, testConnection } = require('../services/winrmService');

router.use(requireAuth);

// ── Ensure tables exist ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS winrm_servers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    ip_address     TEXT NOT NULL,
    winrm_port     INTEGER DEFAULT 5985,
    winrm_https    INTEGER DEFAULT 0,
    winrm_user     TEXT NOT NULL,
    winrm_password TEXT,
    description    TEXT,
    group_name     TEXT,
    enabled        INTEGER DEFAULT 1,
    last_seen      TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS winrm_scripts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    content     TEXT NOT NULL,
    tags        TEXT DEFAULT '[]',
    created_by  INTEGER,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS winrm_executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id   INTEGER,
    script_name TEXT,
    server_ids  TEXT,
    status      TEXT DEFAULT 'running',
    result      TEXT,
    started_by  INTEGER,
    started_at  TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS winrm_metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id     INTEGER NOT NULL,
    cpu_pct       INTEGER DEFAULT 0,
    mem_pct       INTEGER DEFAULT 0,
    disk_pct      INTEGER DEFAULT 0,
    uptime_s      INTEGER DEFAULT 0,
    process_count INTEGER DEFAULT 0,
    net_rx_bytes  INTEGER DEFAULT 0,
    net_tx_bytes  INTEGER DEFAULT 0,
    recorded_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_winrm_metrics_server
    ON winrm_metrics (server_id, recorded_at);
`);

// ── Helpers ───────────────────────────────────────────────────────────────────
const omitPw = s => { if (!s) return s; const { winrm_password, ...r } = s; return { ...r, has_password: !!winrm_password }; };

// ── Servers CRUD ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM winrm_servers ORDER BY name').all().map(omitPw));
});

router.post('/', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, ip_address, winrm_port, winrm_https, winrm_user, winrm_password, description, group_name } = req.body;
  if (!name || !ip_address || !winrm_user) return res.status(400).json({ error: 'name, ip_address, winrm_user required' });
  const r = db.prepare(`
    INSERT INTO winrm_servers (name, ip_address, winrm_port, winrm_https, winrm_user, winrm_password, description, group_name)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(name, ip_address, winrm_port || 5985, winrm_https ? 1 : 0, winrm_user, winrm_password || null, description || null, group_name || null);
  res.status(201).json(omitPw(db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(r.lastInsertRowid)));
});

router.put('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { name, ip_address, winrm_port, winrm_https, winrm_user, winrm_password, description, group_name, enabled } = req.body;
  db.prepare(`UPDATE winrm_servers SET
    name=?, ip_address=?, winrm_port=?, winrm_https=?, winrm_user=?,
    winrm_password=COALESCE(?,winrm_password),
    description=?, group_name=?, enabled=? WHERE id=?
  `).run(
    name||s.name, ip_address||s.ip_address, winrm_port||s.winrm_port,
    winrm_https!=null ? (winrm_https?1:0) : s.winrm_https,
    winrm_user||s.winrm_user, winrm_password||null,
    description??s.description, group_name??s.group_name,
    enabled!=null?enabled:s.enabled, req.params.id
  );
  res.json(omitPw(db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(req.params.id)));
});

router.delete('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM winrm_servers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Test connection ───────────────────────────────────────────────────────────
router.post('/:id/test', async (req, res) => {
  const s = db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const result = await testConnection(s);
  if (result.ok) db.prepare("UPDATE winrm_servers SET last_seen=datetime('now') WHERE id=?").run(s.id);
  res.json(result);
});

// ── Get live metrics ──────────────────────────────────────────────────────────
router.get('/:id/metrics/live', async (req, res) => {
  const s = db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const m = await getMetrics(s);
    // Store in metrics table
    db.prepare(`INSERT INTO winrm_metrics (server_id, cpu_pct, mem_pct, disk_pct, uptime_s, process_count, net_rx_bytes, net_tx_bytes)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(s.id, m.cpu_pct, m.mem_pct, m.disk_pct, m.uptime_s, m.process_count, m.net_rx_bytes, m.net_tx_bytes);
    db.prepare("UPDATE winrm_servers SET last_seen=datetime('now') WHERE id=?").run(s.id);
    res.json(m);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get metrics history ───────────────────────────────────────────────────────
router.get('/:id/metrics/history', (req, res) => {
  const hours = { '1h':1,'6h':6,'24h':24,'7d':168,'30d':720 }[req.query.period] || 24;
  const rows  = db.prepare(`
    SELECT cpu_pct, mem_pct, disk_pct, uptime_s, process_count, recorded_at
    FROM winrm_metrics WHERE server_id=?
    AND recorded_at >= datetime('now', '-${hours} hours')
    ORDER BY recorded_at ASC
  `).all(req.params.id);
  res.json(rows);
});

// ── Get process list ──────────────────────────────────────────────────────────
router.get('/:id/processes', async (req, res) => {
  const s = db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const procs = await getProcesses(s, parseInt(req.query.limit) || 50);
    res.json(procs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Scripts CRUD ──────────────────────────────────────────────────────────────
router.get('/scripts', (req, res) => {
  res.json(db.prepare('SELECT * FROM winrm_scripts ORDER BY name').all());
});

router.post('/scripts', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, description, content, tags } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const r = db.prepare(`INSERT INTO winrm_scripts (name, description, content, tags, created_by) VALUES (?,?,?,?,?)`)
    .run(name, description||null, content, JSON.stringify(tags||[]), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM winrm_scripts WHERE id=?').get(r.lastInsertRowid));
});

router.put('/scripts/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM winrm_scripts WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { name, description, content, tags } = req.body;
  db.prepare(`UPDATE winrm_scripts SET name=?,description=?,content=?,tags=?,updated_at=datetime('now') WHERE id=?`)
    .run(name||s.name, description??s.description, content||s.content, JSON.stringify(tags||JSON.parse(s.tags||'[]')), req.params.id);
  res.json(db.prepare('SELECT * FROM winrm_scripts WHERE id=?').get(req.params.id));
});

router.delete('/scripts/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM winrm_scripts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Execution history ─────────────────────────────────────────────────────────
router.get('/executions', (req, res) => {
  res.json(db.prepare(`
    SELECT e.*, u.username as started_by_name
    FROM winrm_executions e LEFT JOIN users u ON u.id=e.started_by
    ORDER BY e.started_at DESC LIMIT 50
  `).all());
});

// ── Run script ────────────────────────────────────────────────────────────────
router.post('/run', requireRole('superadmin', 'admin'), async (req, res) => {
  const { serverIds, scriptId, scriptContent, scriptName } = req.body;
  if (!serverIds?.length) return res.status(400).json({ error: 'No servers selected' });

  let content = scriptContent;
  let sname   = scriptName || 'Ad-hoc';

  if (scriptId) {
    const s = db.prepare('SELECT * FROM winrm_scripts WHERE id=?').get(scriptId);
    if (!s) return res.status(404).json({ error: 'Script not found' });
    content = s.content; sname = s.name;
  }
  if (!content) return res.status(400).json({ error: 'No script content' });

  const servers = serverIds.map(id => db.prepare('SELECT * FROM winrm_servers WHERE id=?').get(id)).filter(Boolean);
  if (!servers.length) return res.status(400).json({ error: 'No valid servers' });

  const execRow = db.prepare(`INSERT INTO winrm_executions (script_id, script_name, server_ids, status, started_by) VALUES (?,?,?,?,?)`)
    .run(scriptId||null, sname, JSON.stringify(serverIds), 'running', req.user.id);
  const executionId = execRow.lastInsertRowid;

  res.status(202).json({ executionId });

  // Run async
  const io = req.app.get('io');
  const results = {};

  await Promise.all(servers.map(async srv => {
    io?.to(`exec_winrm_${executionId}`).emit('winrm:output', {
      executionId, serverId: srv.id, serverName: srv.name,
      type: 'info', data: `Connecting to ${srv.name} (${srv.ip_address}) via WinRM...\n`
    });
    try {
      const r = await executeScript(srv, content, 120);
      results[srv.id] = {
        status:   r.exitCode === 0 ? 'success' : 'failed',
        output:   r.stdout + (r.stderr ? '\n[STDERR]\n' + r.stderr : ''),
        exitCode: r.exitCode,
      };
      io?.to(`exec_winrm_${executionId}`).emit('winrm:output', {
        executionId, serverId: srv.id, serverName: srv.name,
        type: r.exitCode === 0 ? 'stdout' : 'stderr', data: r.stdout + r.stderr
      });
    } catch (e) {
      results[srv.id] = { status: 'error', output: e.message, exitCode: -1 };
    }
    io?.to(`exec_winrm_${executionId}`).emit('winrm:done', {
      executionId, serverId: srv.id, status: results[srv.id].status
    });
  }));

  db.prepare("UPDATE winrm_executions SET status='done', result=?, finished_at=datetime('now') WHERE id=?")
    .run(JSON.stringify(results), executionId);
  io?.to(`exec_winrm_${executionId}`).emit('winrm:all_done', { executionId });
});

// ── Cleanup old metrics ───────────────────────────────────────────────────────
setInterval(() => {
  try { db.prepare("DELETE FROM winrm_metrics WHERE recorded_at < datetime('now', '-7 days')").run(); } catch {}
}, 3600000);

module.exports = router;
