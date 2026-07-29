const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db/database');
const { requireAuth, revokeToken, JWT_SECRET } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const JWT_EXPIRES = '24h';

function deviceHint(ua) {
  if (!ua) return 'Unknown';
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet/i.test(ua)) return 'Tablet';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

function createSession(jti, userId, ip, ua, expiresAt) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO sessions (jti, user_id, ip_address, user_agent, device_hint, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jti, userId, ip || null, ua || null, deviceHint(ua), new Date(expiresAt * 1000).toISOString());
  } catch (e) { console.error('[Auth] createSession error:', e.message); }
}

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

    const decoded2 = jwt.verify(token, JWT_SECRET);
    createSession(jti, user.id, req.ip, req.headers['user-agent'], decoded2.exp);
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
  try { db.prepare('DELETE FROM sessions WHERE jti = ?').run(req.token?.jti); } catch {}
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

// GET /api/auth/sessions — list active sessions for current user
router.get('/sessions', requireAuth, (req, res) => {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

    // Auto-insert current session if it doesn't exist yet (e.g. login before this feature)
    const exists = db.prepare('SELECT id FROM sessions WHERE jti = ?').get(req.token.jti);
    if (!exists) {
      const expiresAt = new Date(req.token.exp * 1000).toISOString();
      const ua = req.headers['user-agent'] || null;
      db.prepare(`
        INSERT OR IGNORE INTO sessions (jti, user_id, ip_address, user_agent, device_hint, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.token.jti, req.user.id, req.ip || null, ua, deviceHint(ua), expiresAt);
    }

    const sessions = db.prepare(`
      SELECT id, ip_address, user_agent, device_hint, created_at, last_seen, expires_at,
             jti = ? as is_current
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_seen DESC
    `).all(req.token.jti, req.user.id);
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/auth/sessions/:id — terminate a specific session
router.delete('/sessions/:id', requireAuth, (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Revoke the token
    const exp = new Date(session.expires_at).getTime() / 1000;
    revokeToken(session.jti, req.user.id, exp);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'auth', entityName: `session:${session.device_hint}`, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/auth/sessions — terminate ALL other sessions
router.delete('/sessions', requireAuth, (req, res) => {
  try {
    const others = db.prepare('SELECT * FROM sessions WHERE user_id = ? AND jti != ?').all(req.user.id, req.token.jti);
    for (const s of others) {
      const exp = new Date(s.expires_at).getTime() / 1000;
      revokeToken(s.jti, req.user.id, exp);
    }
    const result = db.prepare('DELETE FROM sessions WHERE user_id = ? AND jti != ?').run(req.user.id, req.token.jti);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'auth', entityName: `all_other_sessions (${result.changes})`, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true, terminated: result.changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update last_seen on every authenticated request
function updateSessionLastSeen(jti) {
  try { db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE jti = ?").run(jti); } catch {}
}

module.exports = { router, updateSessionLastSeen };
