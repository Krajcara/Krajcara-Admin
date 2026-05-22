const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/api-keys — list own keys
router.get('/', requireAuth, (req, res) => {
  const keys = db.prepare('SELECT id, name, key_prefix, last_used, created_at FROM user_api_keys WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(keys);
});

// POST /api/api-keys — generate new key
router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Key name required' });

  const count = db.prepare('SELECT COUNT(*) as n FROM user_api_keys WHERE user_id = ?').get(req.user.id).n;
  if (count >= 10) return res.status(400).json({ error: 'Maximum 10 API keys per user' });

  const rawKey  = 'ka_' + crypto.randomBytes(32).toString('base64url');
  const prefix  = rawKey.slice(0, 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const result = db.prepare('INSERT INTO user_api_keys (user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)').run(req.user.id, name.trim(), keyHash, prefix);
  res.json({ id: result.lastInsertRowid, name: name.trim(), key: rawKey, key_prefix: prefix, created_at: new Date().toISOString() });
});

// DELETE /api/api-keys/:id — revoke key
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM user_api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

module.exports = router;
