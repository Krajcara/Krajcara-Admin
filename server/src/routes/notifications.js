'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/notifications?limit=20&unread=true
router.get('/', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
  const unread = req.query.unread === 'true';
  let q = 'SELECT * FROM notifications WHERE archived = 0';
  if (unread) q += ' AND read = 0';
  q += ' ORDER BY created_at DESC LIMIT ?';
  const rows  = db.prepare(q).all(limit);
  const total = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0 AND archived = 0').get().n;
  res.json({ notifications: rows, unread_count: total });
});

// GET /api/notifications/log — full log including archived
router.get('/log', requireRole('superadmin', 'admin'), (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const type   = req.query.type;
  const module = req.query.module;
  const search = req.query.search;

  let q = 'SELECT * FROM notifications WHERE 1=1';
  const params = [];
  if (type)   { q += ' AND type = ?';   params.push(type); }
  if (module) { q += ' AND module = ?'; params.push(module); }
  if (search) { q += ' AND (title LIKE ? OR message LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  q += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(q).all(...params);
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN archived=0 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN archived=1 THEN 1 ELSE 0 END) as archived,
      SUM(CASE WHEN type='error' THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN type='warning' THEN 1 ELSE 0 END) as warnings
    FROM notifications
  `).get();

  res.json({ notifications: rows, stats });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  const unread = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0 AND archived = 0').get().n;
  const io = global.io;
  if (io) io.emit('notification:count', { unread_count: unread });
  res.json({ ok: true, unread_count: unread });
});

// PUT /api/notifications/read-all
router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE archived = 0').run();
  const io = global.io;
  if (io) io.emit('notification:count', { unread_count: 0 });
  res.json({ ok: true });
});

// DELETE /api/notifications/:id — archive instead of delete
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE notifications SET archived = 1, read = 1 WHERE id = ?').run(req.params.id);
  const unread = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0 AND archived = 0').get().n;
  const io = global.io;
  if (io) io.emit('notification:count', { unread_count: unread });
  res.json({ ok: true });
});

// DELETE /api/notifications/clear-all — archive all read
router.delete('/clear-all', (req, res) => {
  db.prepare('UPDATE notifications SET archived = 1 WHERE read = 1').run();
  res.json({ ok: true });
});

// DELETE /api/notifications/clear-archived — permanently delete archived (admin only)
router.delete('/purge-archived', requireRole('superadmin', 'admin'), (req, res) => {
  const info = db.prepare('DELETE FROM notifications WHERE archived = 1').run();
  res.json({ ok: true, deleted: info.changes });
});

// GET /api/notifications/settings
router.get('/settings', (req, res) => {
  const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
  const modules = ['monitors','proxmox','routers','dns','licences','entra'];
  const moduleSettings = {};
  for (const m of modules) {
    const val = get(`notif_email_module_${m}`);
    moduleSettings[`module_${m}`] = val === undefined
      ? ['monitors','proxmox','routers','dns'].includes(m)  // defaults
      : val === '1';
  }
  res.json({
    email_enabled:    get('notif_email_enabled') === '1',
    email_sender:     get('notif_email_sender')  || '',
    email_recipients: get('notif_email_recipients') || '',
    ...moduleSettings,
  });
});

// POST /api/notifications/settings
router.post('/settings', requireRole('superadmin', 'admin'), (req, res) => {
  const { email_enabled, email_sender, email_recipients, ...rest } = req.body;
  const set = (k, v) => db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(k, v);
  set('notif_email_enabled', email_enabled ? '1' : '0');
  if (email_sender     !== undefined) set('notif_email_sender',     email_sender);
  if (email_recipients !== undefined) set('notif_email_recipients', email_recipients);
  // Save per-module settings
  const modules = ['monitors','proxmox','routers','dns','licences','entra'];
  for (const m of modules) {
    if (rest[`module_${m}`] !== undefined) {
      set(`notif_email_module_${m}`, rest[`module_${m}`] ? '1' : '0');
    }
  }
  res.json({ ok: true });
});

module.exports = router;
