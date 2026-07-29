const jwt = require('jsonwebtoken');
const db  = require('../db/database');

const JWT_SECRET = process.env.APP_SECRET || 'krajcara-admin-secret-change-in-production';

function isRevoked(jti) {
  if (!jti) return false;
  return !!db.prepare('SELECT jti FROM revoked_tokens WHERE jti = ?').get(jti);
}

function revokeToken(jti, userId, expiresAt) {
  if (!jti) return;
  try {
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
      .run(jti, userId || null, new Date(expiresAt * 1000).toISOString());
  } catch (e) {
    console.error('[Auth] revokeToken error:', e.message);
  }
}

function cleanupRevokedTokens() {
  try {
    const r = db.prepare("DELETE FROM revoked_tokens WHERE expires_at < datetime('now')").run();
    if (r.changes > 0) console.log(`[Auth] Cleaned ${r.changes} expired tokens`);
  } catch (e) {
    console.error('[Auth] cleanup error:', e.message);
  }
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (isRevoked(decoded.jti)) return res.status(401).json({ error: 'Token has been revoked' });

    const user = db.prepare(
      'SELECT id, username, full_name, role, email FROM users WHERE id = ? AND is_active = 1'
    ).get(decoded.userId);

    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    req.user  = user;
    req.token = { jti: decoded.jti, exp: decoded.exp };
    // Update last_seen for this session (fire and forget)
    try { db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE jti = ?").run(decoded.jti); } catch {}
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && (req.user.role === 'superadmin' || roles.includes(req.user.role))) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { requireAuth, requireRole, revokeToken, cleanupRevokedTokens, JWT_SECRET };
