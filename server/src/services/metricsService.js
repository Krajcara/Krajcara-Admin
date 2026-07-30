'use strict';
const https  = require('https');
const axios  = require('axios');
const db     = require('../db/database');

const AGENT  = new https.Agent({ rejectUnauthorized: false });

// ── Ensure tables exist ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS vm_metrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    vmid       TEXT    NOT NULL,
    node       TEXT    NOT NULL,
    name       TEXT,
    type       TEXT    DEFAULT 'qemu',
    cpu_pct    INTEGER DEFAULT 0,
    mem_pct    INTEGER DEFAULT 0,
    mem_used_mb INTEGER DEFAULT 0,
    mem_max_mb  INTEGER DEFAULT 0,
    disk_pct   INTEGER DEFAULT 0,
    disk_used_gb REAL   DEFAULT 0,
    disk_max_gb  REAL   DEFAULT 0,
    recorded_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vm_metrics_vmid_node
    ON vm_metrics (vmid, node, recorded_at);

  CREATE TABLE IF NOT EXISTS node_metrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node       TEXT    NOT NULL,
    cpu_pct    INTEGER DEFAULT 0,
    mem_pct    INTEGER DEFAULT 0,
    mem_used_gb REAL   DEFAULT 0,
    mem_max_gb  REAL   DEFAULT 0,
    disk_pct   INTEGER DEFAULT 0,
    recorded_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_node_metrics_node
    ON node_metrics (node, recorded_at);
`);

function getConfig() {
  const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
  const url  = get('proxmox_url');
  const user = get('proxmox_user') || 'root@pam';
  const tid  = get('proxmox_token_id') || '';
  const sec  = get('proxmox_api_token');
  if (!url || !sec) return null;
  const decSec = sec;
  return { url, token: tid ? `${user}!${tid}=${decSec}` : decSec };
}

async function pveGet(url, path, token) {
  const r = await axios.get(`${url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${token}` },
    httpsAgent: AGENT, timeout: 10000,
  });
  return r.data.data;
}

// ── Collect and store metrics ─────────────────────────────────────────────────
async function collectMetrics() {
  const cfg = getConfig();
  if (!cfg) return;

  let nodes;
  try { nodes = await pveGet(cfg.url, '/nodes', cfg.token); }
  catch (e) { console.error('[Metrics] Cannot reach Proxmox:', e.message); return; }

  const insertVM   = db.prepare(`
    INSERT INTO vm_metrics
      (vmid, node, name, type, cpu_pct, mem_pct, mem_used_mb, mem_max_mb, disk_pct, disk_used_gb, disk_max_gb)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertNode = db.prepare(`
    INSERT INTO node_metrics (node, cpu_pct, mem_pct, mem_used_gb, mem_max_gb, disk_pct)
    VALUES (?,?,?,?,?,?)
  `);

  for (const node of (nodes || []).filter(n => n.status === 'online')) {
    // Node metrics
    try {
      insertNode.run(
        node.node,
        node.cpu    != null ? Math.round(node.cpu * 100)                                : 0,
        node.mem && node.maxmem ? Math.round((node.mem / node.maxmem) * 100)            : 0,
        node.mem    ? parseFloat((node.mem    / 1073741824).toFixed(2))                 : 0,
        node.maxmem ? parseFloat((node.maxmem / 1073741824).toFixed(2))                 : 0,
        node.disk && node.maxdisk ? Math.round((node.disk / node.maxdisk) * 100)        : 0,
      );
    } catch (e) { console.error('[Metrics] Node insert error:', e.message); }

    // VM + LXC metrics
    let vms = [], lxc = [];
    try { vms = await pveGet(cfg.url, `/nodes/${node.node}/qemu`, cfg.token) || []; } catch {}
    try { lxc = await pveGet(cfg.url, `/nodes/${node.node}/lxc`,  cfg.token) || []; } catch {}

    const all = [
      ...vms.map(v => ({ ...v, type: 'qemu' })),
      ...lxc.map(v => ({ ...v, type: 'lxc'  })),
    ].filter(v => v.status === 'running');

    for (const vm of all) {
      try {
        // Disk: try to get current disk from status endpoint (fast, no screenshot)
        let diskPct = 0, diskUsedGb = 0, diskMaxGb = 0;
        if (vm.type === 'lxc') {
          diskPct    = vm.disk && vm.maxdisk ? Math.round((vm.disk / vm.maxdisk) * 100) : 0;
          diskUsedGb = vm.disk    ? parseFloat((vm.disk    / 1073741824).toFixed(2)) : 0;
          diskMaxGb  = vm.maxdisk ? parseFloat((vm.maxdisk / 1073741824).toFixed(2)) : 0;
        }
        // For QEMU use maxdisk as provisioned size (actual fsinfo too slow for every 5min)
        if (vm.type === 'qemu') {
          diskMaxGb  = vm.maxdisk ? parseFloat((vm.maxdisk / 1073741824).toFixed(2)) : 0;
          diskUsedGb = vm.disk    ? parseFloat((vm.disk    / 1073741824).toFixed(2)) : 0;
          diskPct    = vm.maxdisk && vm.disk ? Math.round((vm.disk / vm.maxdisk) * 100) : 0;
        }

        insertVM.run(
          String(vm.vmid), node.node, vm.name || vm.hostname, vm.type,
          vm.cpu  != null ? Math.round(vm.cpu * 100)                                 : 0,
          vm.mem  && vm.maxmem ? Math.round((vm.mem / vm.maxmem) * 100)              : 0,
          vm.mem    ? Math.round(vm.mem    / 1048576)                                : 0,
          vm.maxmem ? Math.round(vm.maxmem / 1048576)                                : 0,
          diskPct, diskUsedGb, diskMaxGb,
        );
      } catch (e) { console.error(`[Metrics] VM ${vm.vmid} insert error:`, e.message); }
    }
  }

  // Cleanup old data — keep 7 days
  try {
    db.prepare("DELETE FROM vm_metrics   WHERE recorded_at < datetime('now', '-7 days')").run();
    db.prepare("DELETE FROM node_metrics WHERE recorded_at < datetime('now', '-7 days')").run();
  } catch {}

  console.log(`[Metrics] Collected at ${new Date().toISOString()}`);
}

module.exports = { collectMetrics };
