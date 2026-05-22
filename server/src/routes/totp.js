const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/database');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const jwt     = require('jsonwebtoken');

let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); } catch { speakeasy = null; }
try { QRCode    = require('qrcode');    } catch { QRCode    = null; }

function checkDeps(res) {
  if (!speakeasy || !QRCode) {
    res.status(501).json({ error: '2FA dependencies not installed' });
    return false;
  }
  return true;
}

// GET /api/totp/status
router.get('/status', requireAuth, (req, res) => {
  const row = db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(req.user.id);
  res.json({ enabled: !!(row?.enabled) });
});

// POST /api/totp/setup — generate secret + QR
router.post('/setup', requireAuth, (req, res) => {
  if (!checkDeps(res)) return;
  const secret = speakeasy.generateSecret({ name: `Krajcara Admin (${req.user.username})`, issuer: 'Krajcara Admin', length: 32 });
  const row = db.prepare('SELECT id FROM user_totp WHERE user_id = ?').get(req.user.id);
  if (row) {
    db.prepare('UPDATE user_totp SET secret=?, enabled=0, backup_codes=NULL WHERE user_id=?').run(secret.base32, req.user.id);
  } else {
    db.prepare('INSERT INTO user_totp (user_id, secret, enabled) VALUES (?,?,0)').run(req.user.id, secret.base32);
  }
  QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'QR generation failed' });
    res.json({ secret: secret.base32, qr: dataUrl });
  });
});

// POST /api/totp/verify — verify code and enable 2FA
router.post('/verify', requireAuth, (req, res) => {
  if (!checkDeps(res)) return;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const row = db.prepare('SELECT secret FROM user_totp WHERE user_id = ?').get(req.user.id);
  if (!row) return res.status(400).json({ error: '2FA setup not initiated' });

  const valid = speakeasy.totp.verify({ secret: row.secret, encoding: 'base32', token: String(code).replace(/\s/g, ''), window: 2 });
  if (!valid) return res.status(400).json({ error: 'Invalid code' });

  const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
  db.prepare('UPDATE user_totp SET enabled=1, backup_codes=? WHERE user_id=?').run(JSON.stringify(backupCodes), req.user.id);
  res.json({ ok: true, backup_codes: backupCodes });
});

// POST /api/totp/disable
router.post('/disable', requireAuth, (req, res) => {
  db.prepare('UPDATE user_totp SET enabled=0, secret=NULL, backup_codes=NULL WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// POST /api/totp/check — called after successful password login when TOTP is required
router.post('/check', (req, res) => {
  if (!checkDeps(res)) return;
  const { user_id, code } = req.body;
  if (!user_id || !code) return res.status(400).json({ error: 'user_id and code required' });

  const row = db.prepare('SELECT secret, backup_codes FROM user_totp WHERE user_id=? AND enabled=1').get(user_id);
  if (!row) return res.status(400).json({ error: '2FA not enabled' });

  const valid = speakeasy.totp.verify({ secret: row.secret, encoding: 'base32', token: String(code).replace(/\s/g, ''), window: 2 });
  if (valid) {
    // Issue full token
    const user  = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(user_id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    const jti   = uuidv4();
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, jti }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ ok: true, token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, first_login: user.first_login === 1, email: user.email } });
  }

  // Check backup codes
  const codes = JSON.parse(row.backup_codes || '[]');
  const upper = String(code).toUpperCase().replace(/\s/g, '');
  const idx   = codes.indexOf(upper);
  if (idx !== -1) {
    codes.splice(idx, 1);
    db.prepare('UPDATE user_totp SET backup_codes=? WHERE user_id=?').run(JSON.stringify(codes), user_id);
    const user  = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(user_id);
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    const jti   = uuidv4();
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, jti }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ ok: true, token, backup_code_used: true, remaining: codes.length, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, first_login: user.first_login === 1, email: user.email } });
  }

  return res.status(401).json({ error: 'Invalid code' });
});

module.exports = router;
