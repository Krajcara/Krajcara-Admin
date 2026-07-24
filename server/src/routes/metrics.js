'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Helper: parse period param ────────────────────────────────────────────────
function periodHours(p) {
  const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
  return map[p] || 24;
}

// ── GET /api/metrics/nodes — node history ─────────────────────────────────────
router.get('/nodes', (req, res) => {
  const hours    = periodHours(req.query.period);
  const nodeFilter = req.query.node;

  let q = `
    SELECT node, cpu_pct, mem_pct, mem_used_gb, mem_max_gb, disk_pct, recorded_at
    FROM node_metrics
    WHERE recorded_at >= datetime('now', '-${hours} hours')
  `;
  const params = [];
  if (nodeFilter) { q += ' AND node = ?'; params.push(nodeFilter); }
  q += ' ORDER BY node, recorded_at ASC';

  const rows = db.prepare(q).all(...params);

  // Group by node
  const byNode = {};
  for (const r of rows) {
    if (!byNode[r.node]) byNode[r.node] = [];
    byNode[r.node].push({
      t:   r.recorded_at,
      cpu: r.cpu_pct,
      mem: r.mem_pct,
      memUsed: r.mem_used_gb,
      memMax:  r.mem_max_gb,
      disk: r.disk_pct,
    });
  }

  res.json({ period: req.query.period || '24h', nodes: byNode });
});

// ── GET /api/metrics/vms — VM list with latest metrics ────────────────────────
router.get('/vms', (req, res) => {
  const rows = db.prepare(`
    SELECT vmid, node, name, type,
      cpu_pct, mem_pct, mem_used_mb, mem_max_mb, disk_pct, disk_used_gb, disk_max_gb,
      recorded_at
    FROM vm_metrics
    WHERE (vmid, node, recorded_at) IN (
      SELECT vmid, node, MAX(recorded_at)
      FROM vm_metrics GROUP BY vmid, node
    )
    ORDER BY node, name
  `).all();
  res.json(rows);
});

// ── GET /api/metrics/vms/:vmid — VM history ───────────────────────────────────
router.get('/vms/:vmid', (req, res) => {
  const hours = periodHours(req.query.period);
  const node  = req.query.node;

  let q = `
    SELECT cpu_pct, mem_pct, mem_used_mb, mem_max_mb, disk_pct, disk_used_gb, disk_max_gb, recorded_at
    FROM vm_metrics
    WHERE vmid = ?
    AND recorded_at >= datetime('now', '-${hours} hours')
  `;
  const params = [req.params.vmid];
  if (node) { q += ' AND node = ?'; params.push(node); }
  q += ' ORDER BY recorded_at ASC';

  const rows   = db.prepare(q).all(...params);
  const latest = db.prepare(`
    SELECT name, type, node FROM vm_metrics WHERE vmid = ? ORDER BY recorded_at DESC LIMIT 1
  `).get(req.params.vmid);

  res.json({
    vmid:   req.params.vmid,
    name:   latest?.name,
    type:   latest?.type,
    node:   latest?.node,
    period: req.query.period || '24h',
    data:   rows.map(r => ({
      t:        r.recorded_at,
      cpu:      r.cpu_pct,
      mem:      r.mem_pct,
      memUsed:  r.mem_used_mb,
      memMax:   r.mem_max_mb,
      disk:     r.disk_pct,
      diskUsed: r.disk_used_gb,
      diskMax:  r.disk_max_gb,
    })),
  });
});

// ── GET /api/metrics/summary — aggregated stats for dashboard ─────────────────
router.get('/summary', (req, res) => {
  const hours = periodHours(req.query.period || '24h');

  const avgByVM = db.prepare(`
    SELECT vmid, node, name, type,
      ROUND(AVG(cpu_pct))  as avg_cpu,
      ROUND(MAX(cpu_pct))  as max_cpu,
      ROUND(AVG(mem_pct))  as avg_mem,
      ROUND(MAX(mem_pct))  as max_mem,
      ROUND(AVG(disk_pct)) as avg_disk,
      MAX(disk_max_gb)     as disk_max_gb,
      COUNT(*) as samples
    FROM vm_metrics
    WHERE recorded_at >= datetime('now', '-${hours} hours')
    GROUP BY vmid, node
    ORDER BY avg_cpu DESC
  `).all();

  const avgByNode = db.prepare(`
    SELECT node,
      ROUND(AVG(cpu_pct))  as avg_cpu,
      ROUND(MAX(cpu_pct))  as max_cpu,
      ROUND(AVG(mem_pct))  as avg_mem,
      ROUND(MAX(mem_pct))  as max_mem,
      COUNT(*) as samples
    FROM node_metrics
    WHERE recorded_at >= datetime('now', '-${hours} hours')
    GROUP BY node
    ORDER BY node
  `).all();

  res.json({ period: req.query.period || '24h', vms: avgByVM, nodes: avgByNode });
});

module.exports = router;
