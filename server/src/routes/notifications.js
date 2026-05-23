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
  let q = 'SELECT * FROM notifications';
  if (unread) q += ' WHERE read = 0';
  q += ' ORDER BY created_at DESC LIMIT ?';
  const rows  = db.prepare(q).all(limit);
  const total = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0').get().n;
  res.json({ notifications: rows, unread_count: total });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  const unread = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0').get().n;
  const io = global.io;
  if (io) io.emit('notification:count', { unread_count: unread });
  res.json({ ok: true, unread_count: unread });
});

// PUT /api/notifications/read-all
router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1').run();
  const io = global.io;
  if (io) io.emit('notification:count', { unread_count: 0 });
  res.json({ ok: true });
});

// DELETE /api/notifications/:id
router.delete('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/notifications/clear-all
router.delete('/clear-all', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM notifications WHERE read = 1').run();
  res.json({ ok: true });
});

// GET /api/notifications/settings
router.get('/settings', (req, res) => {
  const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value || '';
  res.json({
    email_enabled:    get('notif_email_enabled') === '1',
    email_sender:     get('notif_email_sender'),
    email_recipients: get('notif_email_recipients'),
  });
});

// POST /api/notifications/settings
router.post('/settings', requireRole('superadmin', 'admin'), (req, res) => {
  const { email_enabled, email_sender, email_recipients } = req.body;
  const set = (k, v) => db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(k, v);
  set('notif_email_enabled',    email_enabled ? '1' : '0');
  if (email_sender)     set('notif_email_sender',     email_sender);
  if (email_recipients !== undefined) set('notif_email_recipients', email_recipients);
  res.json({ ok: true });
});

module.exports = router;
