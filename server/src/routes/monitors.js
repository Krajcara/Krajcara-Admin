const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

let worker;
function getWorker() {
  if (!worker) {
    try { worker = require('../services/monitorWorker'); } catch {}
  }
  return worker;
}

router.use(requireAuth);

// GET /api/monitors
router.get('/', (req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors ORDER BY label').all();
  res.json(monitors);
});

// GET /api/monitors/public — no auth, for /status page
router.get('/public', (req, res) => {
  // This route needs to be outside requireAuth — handled in index.js
  const monitors = db.prepare(
    'SELECT id, label, type, last_status, last_latency_ms, last_checked_at FROM monitors WHERE enabled = 1 ORDER BY label'
  ).all();
  res.json(monitors);
});

// GET /api/monitors/:id/checks
router.get('/:id/checks', (req, res) => {
  const hours = parseInt(req.query.hours) || 3;
  // Use SQLite datetime format (not ISO with T/Z) for correct string comparison
  const since = new Date(Date.now() - hours * 3600 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);
  const checks = db.prepare(
    'SELECT * FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC LIMIT 1440'
  ).all(req.params.id, since);
  res.json(checks);
});

// GET /api/monitors/:id/uptime
router.get('/:id/uptime', (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);
  const checks = db.prepare(
    'SELECT status, checked_at FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC'
  ).all(req.params.id, since);
  const days = {};
  for (const c of checks) {
    const day = c.checked_at.substring(0, 10);
    if (!days[day]) days[day] = { total: 0, up: 0 };
    days[day].total++;
    if (c.status === 'up' || c.status === 'degraded') days[day].up++;
  }
  res.json(Object.entries(days).map(([date, { total, up }]) => ({
    date, uptime: total > 0 ? Math.round((up / total) * 100) : null
  })));
});

// POST /api/monitors
router.post('/', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { label, type, target, port, interval_s, timeout_s, keyword, expected_status } = req.body;
  if (!label?.trim() || !target?.trim()) return res.status(400).json({ error: 'label and target required' });
  if (!['http', 'https', 'tcp', 'icmp', 'dns'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const r = db.prepare(`
    INSERT INTO monitors (label, type, target, port, interval_s, timeout_s, keyword, expected_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    label.trim(), type, target.trim(),
    port ? parseInt(port) : null,
    parseInt(interval_s) || 60,
    parseInt(timeout_s)  || 10,
    keyword || null,
    parseInt(expected_status) || 200
  );

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(r.lastInsertRowid);
  getWorker()?.registerMonitor(monitor);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'monitors', entityId: r.lastInsertRowid, entityName: label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json(monitor);
});

// PUT /api/monitors/:id
router.put('/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { label, interval_s, timeout_s, keyword, expected_status, enabled } = req.body;
  db.prepare(`
    UPDATE monitors SET label=?, interval_s=?, timeout_s=?, keyword=?, expected_status=?, enabled=?
    WHERE id=?
  `).run(
    label ?? existing.label,
    parseInt(interval_s) || existing.interval_s,
    parseInt(timeout_s)  || existing.timeout_s,
    keyword !== undefined ? (keyword || null) : existing.keyword,
    parseInt(expected_status) || existing.expected_status,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  getWorker()?.unregisterMonitor(parseInt(req.params.id));
  if (updated.enabled) getWorker()?.registerMonitor(updated);

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'monitors', entityId: req.params.id, entityName: updated.label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json(updated);
});

// DELETE /api/monitors/:id
router.delete('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const m = db.prepare('SELECT label FROM monitors WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  getWorker()?.unregisterMonitor(parseInt(req.params.id));
  db.prepare('DELETE FROM monitor_checks WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'monitors', entityId: req.params.id, entityName: m.label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

module.exports = router;
