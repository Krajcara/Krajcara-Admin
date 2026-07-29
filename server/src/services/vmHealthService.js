'use strict';
const https  = require('https');
const { decrypt } = require('./encryptionService');
const axios  = require('axios');
const db     = require('../db/database');
const { createNotification } = require('./notificationService');

const AGENT = new https.Agent({ rejectUnauthorized: false });

// ── Ensure tracking table exists ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS vm_health_tracking (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    vmid           TEXT NOT NULL,
    node           TEXT NOT NULL,
    name           TEXT,
    dark_since     TEXT,
    cpu_at_dark    INTEGER,
    warning_sent   INTEGER DEFAULT 0,
    alert_sent     INTEGER DEFAULT 0,
    last_check     TEXT,
    last_cpu       INTEGER,
    last_dark_pct  INTEGER,
    UNIQUE(vmid, node)
  )
`);

function getConfig() {
  const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
  const url  = get('proxmox_url');
  const user = get('proxmox_user') || 'root@pam';
  const tid  = get('proxmox_token_id') || '';
  const sec  = get('proxmox_api_token');
  if (!url || !sec) return null;
  const decSec = decrypt(sec);
  return { url, token: tid ? `${user}!${tid}=${decSec}` : decSec };
}

async function pveGet(url, path, token) {
  const r = await axios.get(`${url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${token}` },
    httpsAgent: AGENT, timeout: 10000,
  });
  return r.data.data;
}

// Takes a console screenshot and returns % of dark pixels
async function getDarkPct(url, token, node, vmid) {
  try {
    const r = await axios.get(`${url}/api2/json/nodes/${node}/qemu/${vmid}/screenshot`, {
      headers: { Authorization: `PVEAPIToken=${token}` },
      httpsAgent: AGENT, timeout: 15000, responseType: 'arraybuffer',
    });

    const Jimp = require('jimp');
    const img  = await Jimp.read(Buffer.from(r.data));
    let dark = 0, total = 0;

    img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y, idx) => {
      const rv = img.bitmap.data[idx];
      const gv = img.bitmap.data[idx + 1];
      const bv = img.bitmap.data[idx + 2];
      if (rv < 20 && gv < 20 && bv < 20) dark++;
      total++;
    });

    return total > 0 ? Math.round((dark / total) * 100) : 0;
  } catch {
    return null; // screenshot unavailable
  }
}

async function checkVMHealth() {
  const cfg = getConfig();
  if (!cfg) return;

  let nodes;
  try {
    nodes = await pveGet(cfg.url, '/nodes', cfg.token);
  } catch (e) {
    console.error('[VMHealth] Cannot reach Proxmox:', e.message);
    return;
  }

  const now = new Date().toISOString();

  for (const node of (nodes || []).filter(n => n.status === 'online')) {
    let vms;
    try {
      vms = await pveGet(cfg.url, `/nodes/${node.node}/qemu`, cfg.token);
    } catch { continue; }

    const running = (vms || []).filter(v => v.status === 'running');

    for (const vm of running) {
      const cpuPct  = vm.cpu != null ? Math.round(vm.cpu * 100) : 0;
      const highCpu = cpuPct >= 80;

      // Get or create tracking row
      db.prepare(`
        INSERT OR IGNORE INTO vm_health_tracking (vmid, node, name) VALUES (?,?,?)
      `).run(String(vm.vmid), node.node, vm.name);

      let row = db.prepare('SELECT * FROM vm_health_tracking WHERE vmid=? AND node=?')
        .get(String(vm.vmid), node.node);

      let darkPct = null;
      let isDark  = false;

      // Only take screenshot if CPU is high — avoid unnecessary API calls
      if (highCpu) {
        darkPct = await getDarkPct(cfg.url, cfg.token, node.node, vm.vmid);
        isDark  = darkPct != null && darkPct >= 95;
      }

      const isSuspect = highCpu && isDark;

      if (isSuspect) {
        // Start tracking if not already
        if (!row.dark_since) {
          db.prepare(`UPDATE vm_health_tracking SET dark_since=?, cpu_at_dark=? WHERE vmid=? AND node=?`)
            .run(now, cpuPct, String(vm.vmid), node.node);
          row = db.prepare('SELECT * FROM vm_health_tracking WHERE vmid=? AND node=?')
            .get(String(vm.vmid), node.node);
        }

        const sinceMin = Math.round((new Date() - new Date(row.dark_since)) / 60000);

        // Warning after 5 minutes — in-app only
        if (sinceMin >= 5 && !row.warning_sent) {
          createNotification({
            type:       'warning',
            module:     'proxmox',
            title:      `VM možda zamrznuta: ${vm.name}`,
            message:    `CPU ${cpuPct}%, crna konzola već ${sinceMin} min — Node: ${node.node} · VMID: ${vm.vmid}`,
            entityId:   vm.vmid,
            entityName: vm.name,
          });
          db.prepare('UPDATE vm_health_tracking SET warning_sent=1 WHERE vmid=? AND node=?')
            .run(String(vm.vmid), node.node);
          console.log(`[VMHealth] Warning: ${vm.name} (${node.node}) — CPU ${cpuPct}%, dark ${sinceMin}min`);
        }

        // Alert after 15 minutes — triggers email via notificationService
        if (sinceMin >= 15 && !row.alert_sent) {
          createNotification({
            type:       'error',
            module:     'proxmox',
            title:      `VM zamrznuta — potrebna intervencija: ${vm.name}`,
            message:    `CPU ${cpuPct}%, crna konzola već ${sinceMin} min — Node: ${node.node} · VMID: ${vm.vmid}. Preporučuje se hard stop i restart.`,
            entityId:   vm.vmid,
            entityName: vm.name,
          });
          db.prepare('UPDATE vm_health_tracking SET alert_sent=1 WHERE vmid=? AND node=?')
            .run(String(vm.vmid), node.node);
          console.log(`[VMHealth] ALERT: ${vm.name} (${node.node}) — frozen ${sinceMin}min`);
        }

      } else {
        // VM is healthy — if it was tracked, send recovery notification and reset
        if (row.dark_since && (row.warning_sent || row.alert_sent)) {
          createNotification({
            type:       'success',
            module:     'proxmox',
            title:      `VM oporavljena: ${vm.name}`,
            message:    `CPU normalan (${cpuPct}%), konzola aktivna — Node: ${node.node}`,
            entityId:   vm.vmid,
            entityName: vm.name,
          });
        }
        if (row.dark_since) {
          db.prepare(`UPDATE vm_health_tracking SET
            dark_since=NULL, cpu_at_dark=NULL, warning_sent=0, alert_sent=0
            WHERE vmid=? AND node=?`).run(String(vm.vmid), node.node);
        }
      }

      // Always update last check
      db.prepare(`UPDATE vm_health_tracking SET last_check=?, last_cpu=?, last_dark_pct=?, name=?
        WHERE vmid=? AND node=?`).run(now, cpuPct, darkPct, vm.name, String(vm.vmid), node.node);
    }

    // Remove tracking for deleted VMs
    const currentIds = new Set(running.map(v => String(v.vmid)));
    db.prepare('SELECT vmid FROM vm_health_tracking WHERE node=?').all(node.node)
      .filter(r => !currentIds.has(r.vmid))
      .forEach(r => db.prepare('DELETE FROM vm_health_tracking WHERE vmid=? AND node=?')
        .run(r.vmid, node.node));
  }
}

module.exports = { checkVMHealth };
