const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

// GET /api/users
router.get('/', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, email, role, is_active, first_login, created_at, last_login FROM users ORDER BY username').all();
  res.json(users);
});

// POST /api/users
router.post('/', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)').run(username, hash, full_name || null, email || null, role || 'viewer');
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'users', entityId: result.lastInsertRowid, entityName: username, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    throw err;
  }
});

// PUT /api/users/:id
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { full_name, email, role, is_active, password } = req.body;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, first_login = 1 WHERE id = ?').run(hash, req.params.id);
  }

  db.prepare('UPDATE users SET full_name=?, email=?, role=?, is_active=? WHERE id=?')
    .run(full_name ?? existing.full_name, email ?? existing.email, role ?? existing.role, is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active, req.params.id);

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'users', entityId: req.params.id, entityName: existing.username, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// DELETE /api/users/:id
router.delete('/:id', requireAuth, requireRole('superadmin'), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'users', entityId: req.params.id, entityName: user.username, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

module.exports = router;
