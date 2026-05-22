const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/audit
router.get('/', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const { page = 1, limit = 50, username, module, action, status, search, from, to } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [], params = [];

  if (username) { conditions.push('username = ?');    params.push(username); }
  if (module)   { conditions.push('module = ?');      params.push(module); }
  if (action)   { conditions.push('action = ?');      params.push(action); }
  if (status)   { conditions.push('status = ?');      params.push(status); }
  if (from)     { conditions.push('created_at >= ?'); params.push(from); }
  if (to)       { conditions.push('created_at <= ?'); params.push(to + ' 23:59:59'); }
  if (search) {
    conditions.push('(username LIKE ? OR entity_name LIKE ? OR detail LIKE ? OR ip_address LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`).get(...params);
  const rows  = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ rows, total: total.cnt, page: parseInt(page), pages: Math.ceil(total.cnt / parseInt(limit)) });
});

// GET /api/audit/stats
router.get('/stats', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const week  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const totalToday = db.prepare('SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?').get(today + ' 00:00:00');
  const totalWeek  = db.prepare('SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?').get(week + ' 00:00:00');
  const byModule   = db.prepare('SELECT module, COUNT(*) as cnt FROM audit_log WHERE created_at >= ? GROUP BY module ORDER BY cnt DESC LIMIT 10').all(week + ' 00:00:00');
  const byAction   = db.prepare('SELECT action, COUNT(*) as cnt FROM audit_log WHERE created_at >= ? GROUP BY action ORDER BY cnt DESC').all(week + ' 00:00:00');
  const recentLogins = db.prepare("SELECT * FROM audit_log WHERE module='auth' AND action='login' ORDER BY created_at DESC LIMIT 10").all();

  res.json({ totalToday: totalToday.cnt, totalWeek: totalWeek.cnt, byModule, byAction, recentLogins });
});

// GET /api/audit/modules
router.get('/modules', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT DISTINCT module FROM audit_log ORDER BY module').all().map(r => r.module));
});

// DELETE /api/audit/purge
router.delete('/purge', requireAuth, requireRole('superadmin'), (req, res) => {
  const days   = parseInt(req.query.days) || 90;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const result = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff);
  res.json({ deleted: result.changes, cutoff });
});

// GET /api/audit/export/csv
router.get('/export/csv', requireAuth, requireRole('superadmin', 'admin'), (req, res) => {
  const { module: mod, action, status, username, from, to, search } = req.query;
  const conditions = [], params = [];
  if (mod)      { conditions.push('module = ?');       params.push(mod); }
  if (action)   { conditions.push('action = ?');       params.push(action); }
  if (status)   { conditions.push('status = ?');       params.push(status); }
  if (username) { conditions.push('username LIKE ?');  params.push(`%${username}%`); }
  if (from)     { conditions.push('created_at >= ?');  params.push(from); }
  if (to)       { conditions.push('created_at <= ?');  params.push(to + 'T23:59:59'); }
  if (search)   { conditions.push('(username LIKE ? OR entity_name LIKE ? OR detail LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows  = db.prepare(`SELECT created_at, username, module, action, entity_id, entity_name, status, ip_address, detail FROM audit_log ${where} ORDER BY created_at DESC LIMIT 10000`).all(...params);

  const headers = ['Timestamp', 'User', 'Module', 'Action', 'Entity ID', 'Entity Name', 'Status', 'IP Address', 'Detail'];
  const escape  = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const csv     = [headers.join(','), ...rows.map(r => [r.created_at, r.username, r.module, r.action, r.entity_id, r.entity_name, r.status, r.ip_address, r.detail].map(escape).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv);
});

module.exports = router;
