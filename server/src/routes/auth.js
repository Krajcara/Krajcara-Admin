const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db/database');
const { requireAuth, revokeToken, JWT_SECRET } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const JWT_EXPIRES = '24h';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      writeAuditLog({ username, action: 'login', module: 'auth', ip: req.ip, userAgent: req.headers['user-agent'], status: 'error', detail: 'Invalid password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if TOTP is enabled
    const totp = db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(user.id);
    if (totp?.enabled) {
      // Return partial — client must send TOTP code next
      return res.json({ totp_required: true, user_id: user.id });
    }

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const jti   = uuidv4();
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    writeAuditLog({ userId: user.id, username: user.username, action: 'login', module: 'auth', ip: req.ip, userAgent: req.headers['user-agent'] });

    res.json({
      token,
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, first_login: user.first_login === 1, email: user.email }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  revokeToken(req.token?.jti, req.user?.id, req.token?.exp);
  writeAuditLog({ userId: req.user?.id, username: req.user?.username, action: 'logout', module: 'auth', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, full_name, email, role, first_login, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.first_login !== 1) {
    if (!current_password) return res.status(400).json({ error: 'Current password is required' });
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, first_login = 0 WHERE id = ?").run(hash, user.id);
  writeAuditLog({ userId: user.id, username: user.username, action: 'change_password', module: 'auth', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

module.exports = router;
