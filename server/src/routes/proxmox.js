'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const https   = require('https');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function getConfig() {
  const url     = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value;
  const user    = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
  const tokenId = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
  const secret  = db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value || '';
  let token;
  if (secret.includes('!') && secret.includes('=')) token = secret;
  else if (tokenId && secret) token = `${user}!${tokenId}=${secret}`;
  else if (secret?.includes('=')) token = `${user}!${secret}`;
  else token = secret;
  return { url, token, _dbg: { user, tokenId } };
}

async function pveGet(baseUrl, path, token) {
  const res = await axios.get(`${baseUrl}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 12000
  });
  return res.data.data;
}

const OS_MAP = {
  win11:'Windows 11', win10:'Windows 10', win2k22:'Windows Server 2022',
  win2k19:'Windows Server 2019', win2k16:'Windows Server 2016',
  win2k12r2:'Windows Server 2012 R2', win2k8r2:'Windows Server 2008 R2',
  l26:'Linux (2.6+)', l24:'Linux (2.4)', other:'Other OS',
};

function mapOs(ostype, desc) {
  if (desc) {
    const d = desc.toLowerCase();
    if (d.includes('ubuntu'))  return 'Ubuntu';
    if (d.includes('debian'))  return 'Debian';
    if (d.includes('centos'))  return 'CentOS';
    if (d.includes('rocky'))   return 'Rocky Linux';
    if (d.includes('windows server 2022')) return 'Windows Server 2022';
    if (d.includes('windows server 2019')) return 'Windows Server 2019';
  }
  return OS_MAP[ostype] || ostype || null;
}

// GET /api/proxmox/nodes
router.get('/nodes', async (req, res) => {
  const cfg = getConfig();
  if (!cfg.url) return res.json({ configured: false });

  try {
    const nodes = await pveGet(cfg.url, '/nodes', cfg.token);
    const details = await Promise.all(nodes.map(async (node) => {
      if (node.status !== 'online') {
        return { node: node.node, status: node.status, cpu_usage:0, mem_usage:0, disk_usage:0, mem_used_gb:'0', mem_max_gb:'0', vms:[], lxc:[], storages:[], vm_count:0, lxc_count:0 };
      }

      const [vms, lxc, storages] = await Promise.all([
        pveGet(cfg.url, `/nodes/${node.node}/qemu`, cfg.token).catch(() => []),
        pveGet(cfg.url, `/nodes/${node.node}/lxc`,  cfg.token).catch(() => []),
        pveGet(cfg.url, `/nodes/${node.node}/storage`, cfg.token).catch(() => []),
      ]);

      const enrichedVMs = await Promise.all(vms.map(async (vm) => {
        let config = {}, agentIp = null;
        try { config = await pveGet(cfg.url, `/nodes/${node.node}/qemu/${vm.vmid}/config`, cfg.token); } catch {}
        const isRunning = vm.status === 'running';
        if (isRunning) {
          try {
            const info = await pveGet(cfg.url, `/nodes/${node.node}/qemu/${vm.vmid}/agent/network-get-interfaces`, cfg.token);
            for (const iface of (info?.result || [])) {
              if (iface.name === 'lo') continue;
              const ipv4 = (iface['ip-addresses'] || []).find(a => a['ip-address-type'] === 'ipv4');
              if (ipv4) { agentIp = ipv4['ip-address']; break; }
            }
          } catch {}
        }
        if (!agentIp && config.net0) { const m = config.net0.match(/ip=([^,/]+)/); if (m) agentIp = m[1]; }
        return {
          vmid: vm.vmid, name: vm.name, status: vm.status, type: 'qemu',
          os: mapOs(config.ostype, config.description || vm.name), ip: agentIp,
          cpu_usage:  isRunning && vm.cpu    != null ? Math.round(vm.cpu * 100) : 0,
          mem_usage:  isRunning && vm.mem    && vm.maxmem  ? Math.round((vm.mem  / vm.maxmem)  * 100) : 0,
          disk_usage: vm.disk && vm.maxdisk  ? Math.round((vm.disk / vm.maxdisk) * 100) : 0,
          mem_used_gb:  vm.mem    ? (vm.mem    / 1073741824).toFixed(1) : '0',
          mem_max_gb:   vm.maxmem ? (vm.maxmem / 1073741824).toFixed(1) : '0',
          disk_max_gb:  vm.maxdisk? (vm.maxdisk/ 1073741824).toFixed(1) : '0',
          uptime_s: vm.uptime || 0, cpus: vm.cpus || config.cores || 1,
        };
      }));

      const enrichedLXC = await Promise.all(lxc.map(async (ct) => {
        let config = {};
        try { config = await pveGet(cfg.url, `/nodes/${node.node}/lxc/${ct.vmid}/config`, cfg.token); } catch {}
        let ip = null;
        const m = (config.net0 || '').match(/ip=([^,/]+)/);
        if (m && m[1] !== 'dhcp') ip = m[1];
        const isRunning = ct.status === 'running';
        return {
          vmid: ct.vmid, name: ct.name || ct.hostname, status: ct.status, type: 'lxc',
          os: config.ostype || ct.name, ip,
          cpu_usage:  isRunning && ct.cpu  != null ? Math.round(ct.cpu * 100) : 0,
          mem_usage:  isRunning && ct.mem  && ct.maxmem  ? Math.round((ct.mem  / ct.maxmem)  * 100) : 0,
          disk_usage: ct.disk  && ct.maxdisk ? Math.round((ct.disk / ct.maxdisk) * 100) : 0,
          mem_used_gb:  ct.mem    ? (ct.mem    / 1073741824).toFixed(1) : '0',
          mem_max_gb:   ct.maxmem ? (ct.maxmem / 1073741824).toFixed(1) : '0',
          disk_max_gb:  ct.maxdisk? (ct.maxdisk/ 1073741824).toFixed(1) : '0',
          uptime_s: ct.uptime || 0, cpus: ct.cpus || 1,
        };
      }));

      const enrichedStorages = storages.map(s => ({
        storage: s.storage, type: s.type,
        status:    s.active ? 'active' : 'inactive',
        total_gb:  s.total ? (s.total / 1073741824).toFixed(1) : null,
        used_gb:   s.used  ? (s.used  / 1073741824).toFixed(1) : null,
        avail_gb:  s.avail ? (s.avail / 1073741824).toFixed(1) : null,
        usage_pct: s.total && s.used ? Math.round((s.used / s.total) * 100) : null,
      }));

      return {
        node: node.node, status: node.status,
        cpu_usage:  node.cpu   != null  ? Math.round(node.cpu  * 100) : 0,
        mem_usage:  node.mem   && node.maxmem  ? Math.round((node.mem  / node.maxmem)  * 100) : 0,
        disk_usage: node.disk  && node.maxdisk ? Math.round((node.disk / node.maxdisk) * 100) : 0,
        mem_used_gb: node.mem    ? (node.mem    / 1073741824).toFixed(1) : '0',
        mem_max_gb:  node.maxmem ? (node.maxmem / 1073741824).toFixed(1) : '0',
        maxcpu: node.maxcpu, uptime: node.uptime,
        vms: enrichedVMs, lxc: enrichedLXC, storages: enrichedStorages,
        vm_count: vms.length, lxc_count: lxc.length,
      };
    }));

    res.json({ configured: true, nodes: details });
  } catch (err) {
    const s = err.response?.status || 500;
    let msg = err.response?.data?.errors?.[0]?.message || err.message;
    if (s === 401) msg = `Authentication failed — check Token ID "${cfg._dbg.tokenId}" and secret in Proxmox → Datacenter → API Tokens`;
    res.status(s === 401 || s === 403 ? 503 : s).json({ error: msg });
  }
});

// POST /api/proxmox/:node/:type/:vmid/:action
router.post('/:node/:type/:vmid/:action', requireRole('superadmin', 'admin'), async (req, res) => {
  const { node, type, vmid, action } = req.params;
  if (!['start','stop','reboot','shutdown','reset','suspend','resume'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  if (!['qemu','lxc'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const cfg = getConfig();
  if (!cfg.url) return res.status(503).json({ error: 'Proxmox not configured' });
  try {
    await axios.post(`${cfg.url}/api2/json/nodes/${node}/${type}/${vmid}/status/${action}`, {},
      { headers: { Authorization: `PVEAPIToken=${cfg.token}` }, httpsAgent, timeout: 15000 });
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'proxmox', entityName: `${vmid} ${action}`, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// GET /api/proxmox/config
router.get('/config', (req, res) => {
  const url     = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value || '';
  const user    = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
  const tokenId = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
  const hasSecret = !!(db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value);
  res.json({ configured: !!(url && hasSecret), url, user, tokenId, hasSecret });
});

// POST /api/proxmox/config
router.post('/config', requireRole('superadmin', 'admin'), (req, res) => {
  const { url, user, token_id, api_token } = req.body;
  const save = (k, v) => {
    if (v === undefined || v === null) return;
    db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(k, v);
  };
  save('proxmox_url', url?.replace(/\/$/, ''));
  save('proxmox_user', user || 'root@pam');
  save('proxmox_token_id', token_id);
  if (api_token && api_token !== '***') save('proxmox_api_token', api_token);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'proxmox', entityName: 'config', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

module.exports = router;
