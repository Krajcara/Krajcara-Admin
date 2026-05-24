const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const SECRET_KEYS = [
  'smtp_pass', 'app_secret_display'
];

const ALL_KEYS = [
  'app_name', 'github_repo',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'metrics_retention_days', 'audit_retention_days',
];

function getSettings(maskSecrets = true) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => {
    s[r.key] = (maskSecrets && SECRET_KEYS.includes(r.key) && r.value) ? '***' : r.value;
  });
  if (!s.app_name) s.app_name = 'Krajcara Admin';
  return s;
}

// GET /api/settings
router.get('/', requireAuth, (req, res) => res.json(getSettings()));

// GET /api/settings/app — public (used by login page for app name)
router.get('/app', (req, res) => {
  const name = db.prepare("SELECT value FROM settings WHERE key='app_name'").get()?.value || 'Krajcara Admin';
  res.json({ app_name: name });
});

// POST /api/settings/save
router.post('/save', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  db.transaction(() => {
    for (const [key, val] of Object.entries(req.body)) {
      if (!ALL_KEYS.includes(key)) continue;
      if (val === '***' || val === null || val === undefined) continue;
      stmt.run(key, val === '' ? null : String(val));
    }
  })();
  res.json({ ok: true });
});

// POST /api/settings/test/smtp
router.post('/test/smtp', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const nodemailer = require('nodemailer');
    const s = getSettings(false);
    const host = req.body.smtp_host || s.smtp_host;
    const port = parseInt(req.body.smtp_port || s.smtp_port || 587);
    const user = req.body.smtp_user || s.smtp_user;
    const pass = (req.body.smtp_pass && req.body.smtp_pass !== '***') ? req.body.smtp_pass : s.smtp_pass;
    const from = req.body.smtp_from || s.smtp_from || user;

    if (!host) return res.json({ ok: false, error: 'SMTP host not configured' });

    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined, tls: { rejectUnauthorized: false } });
    await transporter.verify();
    res.json({ ok: true, message: 'SMTP connection successful' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
