'use strict';
const express    = require('express');
const router     = express.Router();
const db         = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Client } = require('ssh2');

router.use(requireAuth);

// ── Ensure tables exist ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS ssh_servers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    ip_address   TEXT NOT NULL,
    ssh_port     INTEGER DEFAULT 22,
    ssh_user     TEXT NOT NULL,
    ssh_auth     TEXT DEFAULT 'password',
    ssh_password TEXT,
    ssh_key      TEXT,
    ssh_passphrase TEXT,
    os_type      TEXT DEFAULT 'linux',
    description  TEXT,
    tags         TEXT DEFAULT '[]',
    group_name   TEXT,
    enabled      INTEGER DEFAULT 1,
    last_seen    TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ssh_scripts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    os_type     TEXT DEFAULT 'linux',
    content     TEXT NOT NULL,
    tags        TEXT DEFAULT '[]',
    created_by  INTEGER,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS script_executions (
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
`);

// ── Helpers ───────────────────────────────────────────────────────────────────
const omitKey = s => {
  if (!s) return s;
  const { ssh_password, ssh_key, ssh_passphrase, ...rest } = s;
  return { ...rest, has_password: !!ssh_password, has_key: !!ssh_key };
};

// ── Servers CRUD ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM ssh_servers ORDER BY name').all();
  res.json(rows.map(omitKey));
});

router.post('/', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, ip_address, ssh_port, ssh_user, ssh_auth, ssh_password, ssh_key, ssh_passphrase, os_type, description, tags, group_name } = req.body;
  if (!name || !ip_address || !ssh_user) return res.status(400).json({ error: 'name, ip_address, ssh_user required' });
  const r = db.prepare(`
    INSERT INTO ssh_servers (name, ip_address, ssh_port, ssh_user, ssh_auth, ssh_password, ssh_key, ssh_passphrase, os_type, description, tags, group_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(name, ip_address, ssh_port || 22, ssh_user, ssh_auth || 'password',
    ssh_password ? ssh_password : null,
    ssh_key ? ssh_key : null,
    ssh_passphrase ? ssh_passphrase : null,
    os_type || 'linux', description || null,
    JSON.stringify(tags || []), group_name || null);
  res.status(201).json(omitKey(db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(r.lastInsertRowid)));
});

router.put('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, ip_address, ssh_port, ssh_user, ssh_auth, ssh_password, ssh_key, ssh_passphrase, os_type, description, tags, group_name, enabled } = req.body;
  const existing = db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE ssh_servers SET name=?,ip_address=?,ssh_port=?,ssh_user=?,ssh_auth=?,
    ssh_password=COALESCE(?,ssh_password),
    ssh_key=COALESCE(?,ssh_key),
    ssh_passphrase=COALESCE(?,ssh_passphrase),
    os_type=?,description=?,tags=?,group_name=?,enabled=? WHERE id=?
  `).run(
    name||existing.name, ip_address||existing.ip_address, ssh_port||existing.ssh_port,
    ssh_user||existing.ssh_user, ssh_auth||existing.ssh_auth,
    ssh_password ? ssh_password : null,
    ssh_key ? ssh_key : null,
    ssh_passphrase ? ssh_passphrase : null,
    os_type||existing.os_type, description??existing.description,
    JSON.stringify(tags||JSON.parse(existing.tags||'[]')),
    group_name??existing.group_name,
    enabled!=null?enabled:existing.enabled,
    req.params.id
  );
  res.json(omitKey(db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(req.params.id)));
});

router.delete('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM ssh_servers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Test connection ───────────────────────────────────────────────────────────
router.post('/:id/test', (req, res) => {
  const srv = db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(req.params.id);
  if (!srv) return res.status(404).json({ error: 'Not found' });

  const conn = new Client();
  const timeout = setTimeout(() => { conn.end(); res.json({ ok: false, error: 'Connection timeout (15s)' }); }, 15000);

  const sshOpts = { host: srv.ip_address, port: srv.ssh_port || 22, username: srv.ssh_user, readyTimeout: 14000 };
  if (srv.ssh_key) { sshOpts.privateKey = srv.ssh_key; if (srv.ssh_passphrase) sshOpts.passphrase = srv.ssh_passphrase; }
  else if (srv.ssh_password) sshOpts.password = srv.ssh_password;

  conn.on('ready', () => {
    clearTimeout(timeout);
    db.prepare("UPDATE ssh_servers SET last_seen=datetime('now') WHERE id=?").run(srv.id);
    conn.end();
    res.json({ ok: true, message: 'Connection successful' });
  });
  conn.on('error', err => { clearTimeout(timeout); conn.end(); res.json({ ok: false, error: err.message }); });
  conn.connect(sshOpts);
});

// ── Scripts CRUD ──────────────────────────────────────────────────────────────
router.get('/scripts', (req, res) => {
  res.json(db.prepare('SELECT * FROM ssh_scripts ORDER BY name').all());
});

router.post('/scripts', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, description, os_type, content, tags } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const r = db.prepare(`
    INSERT INTO ssh_scripts (name, description, os_type, content, tags, created_by)
    VALUES (?,?,?,?,?,?)
  `).run(name, description||null, os_type||'linux', content, JSON.stringify(tags||[]), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM ssh_scripts WHERE id=?').get(r.lastInsertRowid));
});

router.put('/scripts/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const { name, description, os_type, content, tags } = req.body;
  const s = db.prepare('SELECT * FROM ssh_scripts WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE ssh_scripts SET name=?,description=?,os_type=?,content=?,tags=?,updated_at=datetime('now') WHERE id=?`)
    .run(name||s.name, description??s.description, os_type||s.os_type, content||s.content, JSON.stringify(tags||JSON.parse(s.tags||'[]')), req.params.id);
  res.json(db.prepare('SELECT * FROM ssh_scripts WHERE id=?').get(req.params.id));
});

router.delete('/scripts/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM ssh_scripts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Script executions history ─────────────────────────────────────────────────
router.get('/executions', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.username as started_by_name
    FROM script_executions e LEFT JOIN users u ON u.id=e.started_by
    ORDER BY e.started_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

router.get('/executions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM script_executions WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ── Run script ────────────────────────────────────────────────────────────────
router.post('/run', requireRole('superadmin', 'admin'), async (req, res) => {
  const { serverIds, scriptId, scriptContent, scriptName } = req.body;
  if (!serverIds?.length) return res.status(400).json({ error: 'No servers selected' });

  let content = scriptContent;
  let sname   = scriptName || 'Ad-hoc script';

  if (scriptId) {
    const s = db.prepare('SELECT * FROM ssh_scripts WHERE id=?').get(scriptId);
    if (!s) return res.status(404).json({ error: 'Script not found' });
    content = s.content;
    sname   = s.name;
  }

  if (!content) return res.status(400).json({ error: 'No script content' });

  const servers = serverIds.map(id => db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(id)).filter(Boolean);
  if (!servers.length) return res.status(400).json({ error: 'No valid servers' });

  // Create execution record
  const execRow = db.prepare(`
    INSERT INTO script_executions (script_id, script_name, server_ids, status, started_by)
    VALUES (?,?,?,?,?)
  `).run(scriptId||null, sname, JSON.stringify(serverIds), 'running', req.user.id);

  const executionId = execRow.lastInsertRowid;
  res.status(202).json({ executionId, message: 'Execution started' });

  // Run async
  const io = req.app.get('io');
  const { runScript } = require('../services/scriptRunner');
  runScript({ executionId, servers, scriptContent: content, scriptName: sname, io }).catch(e => {
    console.error('[ScriptRunner] Error:', e.message);
    db.prepare("UPDATE script_executions SET status='error', finished_at=datetime('now') WHERE id=?").run(executionId);
  });
});

module.exports = router;
