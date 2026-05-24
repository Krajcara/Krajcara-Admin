'use strict';
const db    = require('../db/database');
const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function getProxmoxConfig() {
  const url     = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value;
  const tokenId = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
  const user    = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
  const secret  = db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value;
  if (!url || !secret) return null;
  const token = tokenId ? `${user}!${tokenId}=${secret}` : secret;
  return { url, token };
}

async function pveGet(url, path, token) {
  const r = await axios.get(`${url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 15000
  });
  return r.data.data;
}

async function pvePost(url, path, token, data = {}) {
  const r = await axios.post(`${url}/api2/json${path}`, data, {
    headers: { Authorization: `PVEAPIToken=${token}`, 'Content-Type': 'application/json' },
    httpsAgent, timeout: 30000
  });
  return r.data.data;
}

// Execute command in VM via guest agent and wait for result
async function agentExec(url, token, node, vmid, type, command) {
  const endpoint = `/nodes/${node}/${type}/${vmid}/agent/exec`;
  const r = await pvePost(url, endpoint, token, { command });
  const pid = r.pid;
  if (!pid) throw new Error('No PID returned from agent exec');

  // Poll for result (max 30 seconds)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const status = await pveGet(url, `/nodes/${node}/${type}/${vmid}/agent/exec-status?pid=${pid}`, token);
      if (status.exited) {
        return {
          exitcode: status.exitcode,
          stdout:   status['out-data'] || '',
          stderr:   status['err-data'] || '',
        };
      }
    } catch {}
  }
  throw new Error('Command timed out (30s)');
}

// ── OS detection ──────────────────────────────────────────────────────────────
async function detectOS(url, token, node, vmid, type) {
  // For LXC, try direct file read via Proxmox API first
  if (type === 'lxc') {
    try {
      const r = await agentExec(url, token, node, vmid, type, ['cat', '/etc/os-release']);
      if (r.exitcode === 0 && r.stdout) {
        return parseOsRelease(r.stdout);
      }
    } catch {}
    // LXC fallback: check for apt/dnf directly
    try {
      const r = await agentExec(url, token, node, vmid, type, ['which', 'apt-get']);
      if (r.exitcode === 0) return 'apt';
    } catch {}
    try {
      const r = await agentExec(url, token, node, vmid, type, ['which', 'dnf']);
      if (r.exitcode === 0) return 'dnf';
    } catch {}
    return 'apt'; // Default for Debian LXC
  }

  // For QEMU VMs
  try {
    const r = await agentExec(url, token, node, vmid, type, ['cat', '/etc/os-release']);
    if (r.exitcode === 0 && r.stdout) {
      return parseOsRelease(r.stdout);
    }
  } catch {}

  // Try Windows
  try {
    const r = await agentExec(url, token, node, vmid, type, ['cmd.exe', '/c', 'ver']);
    if (r.exitcode === 0 && r.stdout.toLowerCase().includes('windows')) return 'windows';
  } catch {}

  // Try which apt as last resort
  try {
    const r = await agentExec(url, token, node, vmid, type, ['which', 'apt-get']);
    if (r.exitcode === 0) return 'apt';
  } catch {}

  return 'unknown';
}

function parseOsRelease(content) {
  const id = content.match(/^ID=(.+)$/m)?.[1]?.replace(/"/g, '').toLowerCase().trim();
  if (!id) return 'unknown';
  if (['ubuntu', 'debian', 'raspbian'].includes(id)) return 'apt';
  if (['rhel', 'centos', 'rocky', 'fedora', 'almalinux', 'ol'].includes(id)) return 'dnf';
  if (id === 'alpine') return 'apk';
  // Check ID_LIKE as fallback
  const idLike = content.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/"/g, '').toLowerCase().trim();
  if (idLike?.includes('debian') || idLike?.includes('ubuntu')) return 'apt';
  if (idLike?.includes('rhel') || idLike?.includes('fedora')) return 'dnf';
  return 'linux';
}

// ── Parse package lists ───────────────────────────────────────────────────────
function parseApt(output) {
  const packages = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^([^/]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]/);
    if (m) packages.push({ name: m[1].trim(), available: m[2], current: m[3], severity: detectSeverityApt(m[1]) });
  }
  return packages;
}

function parseDnf(output) {
  const packages = [];
  for (const line of output.split('\n')) {
    if (!line.trim() || line.startsWith('Last') || line.startsWith('Loaded') || line.startsWith('Loading')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name    = parts[0].replace(/\.\w+$/, ''); // strip arch
      const version = parts[1];
      packages.push({ name, available: version, current: null, severity: 'unknown' });
    }
  }
  return packages;
}

function parseApk(output) {
  const packages = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^([^<>]+)\s+[<>]\s+\[(\S+)\]/);
    if (m) packages.push({ name: m[1].trim(), available: m[2], current: null, severity: 'unknown' });
  }
  return packages;
}

function parseWindows(output) {
  // PSWindowsUpdate output: Title, KB, Size, etc
  const packages = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('Title') || trimmed.startsWith('KB')) continue;
    // Try to extract KB article and title
    const kbMatch = trimmed.match(/(KB\d+)/i);
    if (kbMatch || trimmed.length > 10) {
      const severity = trimmed.toLowerCase().includes('security') ? 'security'
        : trimmed.toLowerCase().includes('critical') ? 'critical' : 'unknown';
      packages.push({ name: kbMatch ? kbMatch[1] : trimmed.substring(0, 60), available: 'update', current: null, severity });
    }
  }
  return packages;
}

function detectSeverityApt(name) {
  const sec = ['openssl','libssl','openssh','kernel','linux-image','sudo','glibc','libc6','curl','wget','nginx','apache2','php','python3'];
  return sec.some(s => name.toLowerCase().includes(s)) ? 'security' : 'unknown';
}

// ── Check single VM ───────────────────────────────────────────────────────────
async function checkVM(url, token, node, vmid, vmName, vmType) {
  const osType = await detectOS(url, token, node, vmid, vmType);

  let output = '', packages = [];

  if (osType === 'apt') {
    const r = await agentExec(url, token, node, vmid, vmType, ['apt', 'list', '--upgradable', '-qq']);
    output   = r.stdout;
    packages = parseApt(output);
  } else if (osType === 'dnf') {
    try {
      const r = await agentExec(url, token, node, vmid, vmType, ['dnf', 'check-update', '--quiet']);
      output   = r.stdout;
      packages = parseDnf(output);
    } catch {
      const r = await agentExec(url, token, node, vmid, vmType, ['yum', 'check-update', '--quiet']);
      output   = r.stdout;
      packages = parseDnf(output);
    }
  } else if (osType === 'apk') {
    const r = await agentExec(url, token, node, vmid, vmType, ['apk', 'list', '--upgradable']);
    output   = r.stdout;
    packages = parseApk(output);
  } else if (osType === 'windows') {
    // PowerShell — Get-WindowsUpdate requires PSWindowsUpdate module
    const cmd = ['powershell.exe', '-NonInteractive', '-Command',
      'Get-WindowsUpdate -NotInstalled | Select-Object -Property Title,KB | Format-List'];
    const r  = await agentExec(url, token, node, vmid, vmType, cmd);
    output   = r.stdout;
    packages = parseWindows(output);
  } else {
    return { osType, packages: [], error: 'Unsupported OS or agent not available' };
  }

  return { osType, packages, error: null };
}

// ── Main check function ───────────────────────────────────────────────────────
async function runPatchCheck(targetVmId = null) {
  const cfg = getProxmoxConfig();
  if (!cfg) { console.log('[Patches] Proxmox not configured'); return; }

  let nodes;
  try {
    nodes = await pveGet(cfg.url, '/nodes', cfg.token);
  } catch (e) { console.error('[Patches] Cannot reach Proxmox:', e.message); return; }

  for (const node of nodes) {
    if (node.status !== 'online') continue;

    const [vms, lxcs] = await Promise.all([
      pveGet(cfg.url, `/nodes/${node.node}/qemu`, cfg.token).catch(() => []),
      pveGet(cfg.url, `/nodes/${node.node}/lxc`,  cfg.token).catch(() => []),
    ]);

    const allVMs = [
      ...(vms  || []).map(v => ({ ...v, type: 'qemu' })),
      ...(lxcs || []).map(v => ({ ...v, type: 'lxc'  })),
    ].filter(v => v.status === 'running');

    for (const vm of allVMs) {
      if (targetVmId && vm.vmid !== targetVmId) continue;

      console.log(`[Patches] Checking ${vm.name} (${vm.vmid}) on ${node.node}...`);

      try {
        const result = await checkVM(cfg.url, cfg.token, node.node, vm.vmid, vm.name, vm.type);

        // Clear old patch data for this VM
        db.prepare('DELETE FROM patch_status WHERE node = ? AND vm_id = ?').run(node.node, vm.vmid);

        // Insert new packages
        const insert = db.prepare(`
          INSERT OR REPLACE INTO patch_status
            (node, vm_id, vm_name, vm_type, os_type, package_name, current_version, available_version, severity, checked_at)
          VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
        `);
        for (const pkg of result.packages) {
          insert.run(node.node, vm.vmid, vm.name, vm.type, result.osType,
            pkg.name, pkg.current || null, pkg.available, pkg.severity || 'unknown');
        }

        // Log
        db.prepare(`
          INSERT INTO patch_check_log (node, vm_id, vm_name, vm_type, os_type, status, pkg_count, checked_at)
          VALUES (?,?,?,?,?,?,?,datetime('now'))
        `).run(node.node, vm.vmid, vm.name, vm.type, result.osType,
          result.error ? 'error' : 'ok',
          result.packages.length);

        console.log(`[Patches] ${vm.name}: ${result.packages.length} updates (${result.osType})`);
      } catch (e) {
        console.error(`[Patches] ${vm.name} error:`, e.message);
        db.prepare(`
          INSERT INTO patch_check_log (node, vm_id, vm_name, vm_type, status, error, checked_at)
          VALUES (?,?,?,?,?,?,datetime('now'))
        `).run(node.node, vm.vmid, vm.name, vm.type || 'qemu', 'error', e.message.substring(0, 500));
      }
    }
  }
  console.log('[Patches] Check complete');
}

module.exports = { runPatchCheck };
