'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/patches — summary per VM
router.get('/', (req, res) => {
  const vms = db.prepare(`
    SELECT
      node, vm_id, vm_name, vm_type, os_type,
      COUNT(*) as update_count,
      SUM(CASE WHEN severity IN ('security','critical') THEN 1 ELSE 0 END) as security_count,
      MAX(checked_at) as checked_at
    FROM patch_status
    GROUP BY node, vm_id, vm_name, vm_type, os_type
    ORDER BY security_count DESC, update_count DESC, vm_name
  `).all();

  // Also include VMs that were checked but have 0 updates
  const logs = db.prepare(`
    SELECT DISTINCT ON(node, vm_id) node, vm_id, vm_name, vm_type, os_type, status, error, checked_at
    FROM (
      SELECT node, vm_id, vm_name, vm_type, os_type, status, error, checked_at
      FROM patch_check_log
      ORDER BY checked_at DESC
    )
    GROUP BY node, vm_id
  `).all();

  // Merge: add VMs from logs that have 0 updates
  const vmIds = new Set(vms.map(v => `${v.node}-${v.vm_id}`));
  for (const log of logs) {
    if (!vmIds.has(`${log.node}-${log.vm_id}`)) {
      vms.push({ ...log, update_count: 0, security_count: 0 });
    }
  }

  res.json(vms);
});

// GET /api/patches/:node/:vmid — packages for one VM
router.get('/:node/:vmid', (req, res) => {
  const { node, vmid } = req.params;
  const packages = db.prepare(`
    SELECT * FROM patch_status WHERE node = ? AND vm_id = ?
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'security' THEN 1 ELSE 2 END,
      package_name
  `).all(node, parseInt(vmid));

  const log = db.prepare(`
    SELECT * FROM patch_check_log WHERE node = ? AND vm_id = ?
    ORDER BY checked_at DESC LIMIT 1
  `).get(node, parseInt(vmid));

  res.json({ packages, last_check: log || null });
});

// POST /api/patches/check — trigger full check or single VM
router.post('/check', requireRole('superadmin', 'admin'), async (req, res) => {
  const { vm_id } = req.body;
  res.json({ ok: true, message: vm_id ? `Checking VM ${vm_id}...` : 'Full patch check started...' });

  try {
    const { runPatchCheck } = require('../services/patchService');
    await runPatchCheck(vm_id ? parseInt(vm_id) : null);
    const io = global.io;
    if (io) io.emit('patches:done', { vm_id: vm_id || null });
  } catch (e) {
    console.error('[Patches] Check error:', e.message);
  }
});

// GET /api/patches/log — check history
router.get('/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(db.prepare(
    'SELECT * FROM patch_check_log ORDER BY checked_at DESC LIMIT ?'
  ).all(limit));
});

module.exports = router;
