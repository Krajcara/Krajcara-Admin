'use strict';
const express = require('express');
const router  = express.Router();
const cron    = require('node-cron');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getResults(scanId) {
  const results = db.prepare('SELECT * FROM scan_results WHERE scan_id = ?').all(scanId);
  return results.map(r => ({
    ...r,
    ports: db.prepare('SELECT * FROM port_findings WHERE result_id = ?').all(r.id)
  }));
}

// ── Hosts ─────────────────────────────────────────────────────────────────────
router.get('/hosts', (req, res) => {
  res.json(db.prepare('SELECT * FROM scan_hosts ORDER BY created_at DESC').all());
});

router.post('/hosts', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { label, target, target_type, description } = req.body;
  if (!label?.trim() || !target?.trim()) return res.status(400).json({ error: 'label and target required' });
  const r = db.prepare('INSERT INTO scan_hosts (label, target, target_type, description) VALUES (?,?,?,?)')
    .run(label.trim(), target.trim(), target_type || 'ip', description || null);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'scanner', entityId: r.lastInsertRowid, entityName: label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ id: r.lastInsertRowid });
});

router.put('/hosts/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { label, description } = req.body;
  const h = db.prepare('SELECT * FROM scan_hosts WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE scan_hosts SET label=?, description=? WHERE id=?')
    .run(label ?? h.label, description ?? h.description, req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'scanner', entityId: req.params.id, entityName: label ?? h.label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

router.delete('/hosts/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const h = db.prepare('SELECT label FROM scan_hosts WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM scan_hosts WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'scanner', entityId: req.params.id, entityName: h.label, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// ── Scans ─────────────────────────────────────────────────────────────────────
const NMAP_PROFILES = {
  quick:   '-T4 -F --host-timeout 30s',
  full:    '-T4 -p- --host-timeout 120s',
  service: '-T4 -sV -sC --host-timeout 60s',
  stealth: '-T2 -sS --host-timeout 120s',
  os:      '-T4 -O --osscan-guess --host-timeout 60s',
};

router.get('/scans', (req, res) => {
  const { host_id, status, limit = 50, offset = 0 } = req.query;
  let q = 'SELECT s.*, h.label as host_label, h.target as host_target FROM scans s JOIN scan_hosts h ON s.host_id = h.id WHERE 1=1';
  const params = [];
  if (host_id) { q += ' AND s.host_id = ?'; params.push(parseInt(host_id)); }
  if (status)  { q += ' AND s.status = ?';  params.push(status); }
  q += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM scans s WHERE 1=1${host_id ? ' AND s.host_id=?' : ''}${status ? ' AND s.status=?' : ''}`).get(...(host_id?[parseInt(host_id)]:[]), ...(status?[status]:[])).cnt;
  res.json({ total, scans: db.prepare(q).all(...params) });
});

router.get('/scans/queue', (req, res) => {
  try { res.json(require('../services/scanService').getQueueStatus()); }
  catch { res.json({ running: 0, queued: 0, maxConcurrent: 2 }); }
});

router.get('/scans/:id', (req, res) => {
  const scan = db.prepare('SELECT s.*, h.label as host_label, h.target as host_target FROM scans s JOIN scan_hosts h ON s.host_id = h.id WHERE s.id = ?').get(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Not found' });
  res.json({ ...scan, results: getResults(scan.id) });
});

router.post('/scans', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { host_id, profile, nmap_args } = req.body;
  if (!host_id) return res.status(400).json({ error: 'host_id required' });
  const host = db.prepare('SELECT * FROM scan_hosts WHERE id = ?').get(parseInt(host_id));
  if (!host) return res.status(404).json({ error: 'Host not found' });

  const args = profile && profile !== 'custom'
    ? (NMAP_PROFILES[profile] || NMAP_PROFILES.quick)
    : (nmap_args || '-T4 -sV');

  const r = db.prepare('INSERT INTO scans (host_id, user_id, status, profile, nmap_args) VALUES (?,?,?,?,?)')
    .run(parseInt(host_id), req.user.id, 'queued', profile || 'quick', args);

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'scanner', entityId: r.lastInsertRowid, entityName: `Scan: ${host.label}`, ip: req.ip, userAgent: req.headers['user-agent'] });

  const { enqueueScan } = require('../services/scanService');
  enqueueScan(r.lastInsertRowid).catch(err => console.error('[Scanner] Enqueue error:', err.message));

  res.json({ id: r.lastInsertRowid, status: 'queued' });
});

// ── Schedules ─────────────────────────────────────────────────────────────────
const scheduledJobs = new Map();

function registerSchedule(schedule) {
  if (scheduledJobs.has(schedule.id)) {
    scheduledJobs.get(schedule.id).stop();
    scheduledJobs.delete(schedule.id);
  }
  if (!schedule.enabled || !schedule.cron_expr) return;
  try {
    const job = cron.schedule(schedule.cron_expr, async () => {
      const host = db.prepare('SELECT * FROM scan_hosts WHERE id = ?').get(schedule.host_id);
      if (!host) return;
      const args = schedule.profile && schedule.profile !== 'custom'
        ? (NMAP_PROFILES[schedule.profile] || NMAP_PROFILES.quick)
        : (schedule.nmap_args || '-T4 -F');
      const r = db.prepare('INSERT INTO scans (host_id, status, profile, nmap_args) VALUES (?,?,?,?)')
        .run(schedule.host_id, 'queued', schedule.profile || 'quick', args);
      db.prepare("UPDATE scan_schedules SET last_run=datetime('now') WHERE id=?").run(schedule.id);
      const { enqueueScan } = require('../services/scanService');
      enqueueScan(r.lastInsertRowid).catch(() => {});
      console.log(`[Scheduler] Scheduled scan started for "${host.label}" (schedule #${schedule.id})`);
    });
    scheduledJobs.set(schedule.id, job);
  } catch (e) {
    console.error(`[Scheduler] Invalid cron "${schedule.cron_expr}":`, e.message);
  }
}

function initSchedules() {
  const schedules = db.prepare('SELECT * FROM scan_schedules WHERE enabled = 1').all();
  for (const s of schedules) registerSchedule(s);
  console.log(`[Scanner] ${schedules.length} schedule(s) loaded`);
}

router.get('/schedules', (req, res) => {
  const rows = db.prepare('SELECT ss.*, sh.label as host_label, sh.target as host_target FROM scan_schedules ss LEFT JOIN scan_hosts sh ON ss.host_id = sh.id ORDER BY ss.created_at DESC').all();
  res.json(rows);
});

router.post('/schedules', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { host_id, cron_expr, label, profile, nmap_args } = req.body;
  if (!cron_expr) return res.status(400).json({ error: 'cron_expr required' });
  if (!cron.validate(cron_expr)) return res.status(400).json({ error: 'Invalid cron expression' });
  const r = db.prepare('INSERT INTO scan_schedules (host_id, user_id, label, cron_expr, profile, nmap_args, enabled) VALUES (?,?,?,?,?,?,1)')
    .run(host_id ? parseInt(host_id) : null, req.user.id, label || null, cron_expr, profile || 'quick', nmap_args || null);
  const schedule = db.prepare('SELECT * FROM scan_schedules WHERE id = ?').get(r.lastInsertRowid);
  registerSchedule(schedule);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'scanner', entityId: r.lastInsertRowid, entityName: `Schedule: ${label || cron_expr}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ id: r.lastInsertRowid });
});

router.put('/schedules/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM scan_schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { cron_expr, label, nmap_args, enabled } = req.body;
  if (cron_expr && !cron.validate(cron_expr)) return res.status(400).json({ error: 'Invalid cron expression' });
  db.prepare('UPDATE scan_schedules SET cron_expr=?, label=?, nmap_args=?, enabled=? WHERE id=?')
    .run(cron_expr ?? existing.cron_expr, label ?? existing.label, nmap_args ?? existing.nmap_args,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled, req.params.id);
  const updated = db.prepare('SELECT * FROM scan_schedules WHERE id = ?').get(req.params.id);
  registerSchedule(updated);
  res.json({ ok: true });
});

router.delete('/schedules/:id', requireRole('superadmin', 'admin'), (req, res) => {
  if (scheduledJobs.has(parseInt(req.params.id))) {
    scheduledJobs.get(parseInt(req.params.id)).stop();
    scheduledJobs.delete(parseInt(req.params.id));
  }
  db.prepare('DELETE FROM scan_schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Alert rules ───────────────────────────────────────────────────────────────
router.get('/alert-rules', (req, res) => {
  const rules = db.prepare('SELECT ar.*, sh.label as host_label FROM alert_rules ar LEFT JOIN scan_hosts sh ON ar.host_id = sh.id ORDER BY ar.created_at DESC').all();
  res.json(rules.map(r => ({ ...r, channels: JSON.parse(r.channels || '{}') })));
});

router.post('/alert-rules', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { host_id, trigger_type, label, channels, enabled } = req.body;
  if (!trigger_type) return res.status(400).json({ error: 'trigger_type required' });
  const r = db.prepare('INSERT INTO alert_rules (host_id, user_id, label, trigger_type, channels, enabled) VALUES (?,?,?,?,?,?)')
    .run(host_id ? parseInt(host_id) : null, req.user.id, label || null, trigger_type, JSON.stringify(channels || {}), enabled !== false ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});

router.put('/alert-rules/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { trigger_type, label, channels, enabled } = req.body;
  db.prepare('UPDATE alert_rules SET trigger_type=?, label=?, channels=?, enabled=? WHERE id=?')
    .run(trigger_type ?? existing.trigger_type, label ?? existing.label,
      channels ? JSON.stringify(channels) : existing.channels,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled, req.params.id);
  res.json({ ok: true });
});

router.delete('/alert-rules/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Alerts log ────────────────────────────────────────────────────────────────
router.get('/alerts', (req, res) => {
  const { acknowledged, limit = 50, offset = 0 } = req.query;
  let q = 'SELECT sa.*, ar.label as rule_label FROM scan_alerts sa LEFT JOIN alert_rules ar ON sa.rule_id = ar.id WHERE 1=1';
  const params = [];
  if (acknowledged !== undefined) { q += ' AND sa.acknowledged = ?'; params.push(acknowledged === 'true' ? 1 : 0); }
  q += ' ORDER BY sa.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM scan_alerts WHERE 1=1${acknowledged !== undefined ? ' AND acknowledged=?' : ''}`).get(...(acknowledged !== undefined ? [acknowledged === 'true' ? 1 : 0] : [])).cnt;
  res.json({ total, alerts: db.prepare(q).all(...params) });
});

router.put('/alerts/:id/ack', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  db.prepare("UPDATE scan_alerts SET acknowledged=1, acknowledged_by=?, acknowledged_at=datetime('now') WHERE id=?")
    .run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = { router, initSchedules };
