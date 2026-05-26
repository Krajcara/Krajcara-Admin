'use strict';
/**
 * FortiGate SNMP polling — tested on FortiGate-100F
 * Uses new MIB path: 1.3.6.1.4.1.12356.101.*
 */

const snmp = require('net-snmp');

const OID = {
  // Standard
  sysDescr:    '1.3.6.1.2.1.1.1.0',
  sysName:     '1.3.6.1.2.1.1.5.0',
  sysUpTime:   '1.3.6.1.2.1.1.3.0',

  // FortiGate — new MIB path (101.*)
  fgCpuUsage:    '1.3.6.1.4.1.12356.101.4.1.2.0',
  fgMemUsage:    '1.3.6.1.4.1.12356.101.4.1.4.0',
  fgMemCapacity: '1.3.6.1.4.1.12356.101.4.1.5.0',
  fgSessions:    '1.3.6.1.4.1.12356.101.4.1.6.0',

  // VPN SSL stats
  fgVpnSslLoginUsers:  '1.3.6.1.4.1.12356.101.12.2.3.1.1', // fgVpnSslStatsLoginUsers — walk column, sum all VDOMs
  fgVpnSslTunnels:     '1.3.6.1.4.1.12356.101.12.2.3.1.2', // fgVpnSslStatsTunnels — fallback column
  // VPN SSL session table (12.2.4.1.x.INDEX)
  fgVpnSslTunnelIndex:    '1.3.6.1.4.1.12356.101.12.2.4.1.1',  // index
  fgVpnSslTunnelVdom:     '1.3.6.1.4.1.12356.101.12.2.4.1.2',  // vdom id
  fgVpnSslTunnelUser:     '1.3.6.1.4.1.12356.101.12.2.4.1.3',  // username
  fgVpnSslTunnelSrcIp:    '1.3.6.1.4.1.12356.101.12.2.4.1.4',  // source IP
  fgVpnSslTunnelIp:       '1.3.6.1.4.1.12356.101.12.2.4.1.5',  // assigned VPN IP
  fgVpnSslTunnelDuration: '1.3.6.1.4.1.12356.101.12.2.4.1.6',  // duration seconds

  // Interface table
  ifDescr:       '1.3.6.1.2.1.2.2.1.2',    // long name (Quarantine VLAN etc) - not used for display
  ifName:        '1.3.6.1.2.1.31.1.1.1.1', // short name (wan1, port7) - USE THIS
  ifOperStatus:  '1.3.6.1.2.1.2.2.1.8',
  ifInOctets:    '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets:   '1.3.6.1.2.1.2.2.1.16',
  ifHCInOctets:  '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifHighSpeed:   '1.3.6.1.2.1.31.1.1.1.15',
  ifAlias:       '1.3.6.1.2.1.31.1.1.1.18',
  // IP table
  ipAdEntAddr:   '1.3.6.1.2.1.4.20.1.1',
  ipAdEntIfIndex:'1.3.6.1.2.1.4.20.1.2',
  // IPSec tunnels
  fgVpnIpsecStatus: '1.3.6.1.4.1.12356.101.12.2.2.1.20',
};

function buildSession(ip, cfg) {
  const port    = parseInt(cfg.snmp_port) || 161;
  const timeout = 8000;
  const retries = 1;
  const v = String(cfg.snmp_version || '2c');

  if (v === '3') {
    const level = cfg.snmp_security_level || 'authPriv';
    const authProto = cfg.snmp_auth_protocol === 'SHA' ? snmp.AuthProtocols.sha : snmp.AuthProtocols.md5;
    const privProto = cfg.snmp_priv_protocol === 'AES' ? snmp.PrivProtocols.aes : snmp.PrivProtocols.des;
    const user = {
      name: cfg.snmp_username || 'snmpv3user',
      level: level === 'noAuthNoPriv' ? snmp.SecurityLevel.noAuthNoPriv
           : level === 'authNoPriv'   ? snmp.SecurityLevel.authNoPriv
           : snmp.SecurityLevel.authPriv,
    };
    if (level !== 'noAuthNoPriv') {
      user.authProtocol = authProto;
      user.authKey      = cfg.snmp_auth_password || '';
    }
    if (level === 'authPriv') {
      user.privProtocol = privProto;
      user.privKey      = cfg.snmp_priv_password || '';
    }
    return snmp.createV3Session(ip, user, { port, timeout, retries, version: snmp.Version3 });
  }

  const community = cfg.snmp_community || 'public';
  const version   = v === '1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(ip, community, { port, timeout, retries, version });
}

function snmpGet(session, oids) {
  return new Promise((resolve) => {
    session.get(oids, (err, varbinds) => {
      const out = {};
      if (!err) {
        varbinds.forEach((vb, i) => {
          if (!snmp.isVarbindError(vb)) {
            const v = vb.value;
            out[oids[i]] = Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g, '') : v;
          }
        });
      }
      resolve(out);
    });
  });
}

function snmpWalk(session, rootOid) {
  return new Promise((resolve) => {
    const results = [];
    session.subtree(rootOid, 50, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const v = vb.value;
          results.push({ oid: vb.oid, value: Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g,'') : v });
        }
      });
    }, () => resolve(results));
  });
}

function idx(oid, rootOid) {
  return oid.replace(rootOid + '.', '');
}

function formatUptime(ticks) {
  if (!ticks) return null;
  const s = Math.floor(parseInt(ticks) / 100);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

async function pollFortigate(ip, cfg) {
  const session = buildSession(ip, cfg);
  try {
    // ── Scalar stats ──────────────────────────────────────────────
    const scalars = await snmpGet(session, [
      OID.sysDescr, OID.sysName, OID.sysUpTime,
      OID.fgCpuUsage, OID.fgMemUsage, OID.fgMemCapacity, OID.fgSessions,
      // SSL VPN fetched via walk below (table indexed by VDOM)
    ]);

    const cpuRaw = scalars[OID.fgCpuUsage];
    const memRaw = scalars[OID.fgMemUsage];

    if (cpuRaw == null && memRaw == null && !scalars[OID.sysName]) {
      session.close();
      return { connected: false, brand: 'fortigate', error: 'SNMP timeout — check IP, community and that AllAdmin server IP is whitelisted on FortiGate' };
    }

    const cpuPct   = cpuRaw != null ? parseInt(cpuRaw) : null;
    const memPct   = memRaw != null ? parseInt(memRaw) : null;
    const memCapKB = scalars[OID.fgMemCapacity] != null ? parseInt(scalars[OID.fgMemCapacity]) : null;
    const sessions = scalars[OID.fgSessions]    != null ? parseInt(scalars[OID.fgSessions])    : null;
    // Try FortiOS 7.x OID first (.1.1), fallback to 6.x (.1.0), then tunnel count
    // Walk SSL VPN login users across all VDOMs and sum
    const [sslLoginWalk, sslTunnelWalk] = await Promise.all([
      snmpWalk(session, OID.fgVpnSslLoginUsers).catch(() => []),
      snmpWalk(session, OID.fgVpnSslTunnels).catch(() => []),
    ]);
    const sumWalk = arr => (Array.isArray(arr) ? arr : Object.values(arr)).reduce((a, v) => a + Number(v?.value ?? v ?? 0), 0);
    const loginSum  = sumWalk(sslLoginWalk);
    const tunnelSum = sumWalk(sslTunnelWalk);
    const sslUserCount = loginSum > 0 ? loginSum : (tunnelSum > 0 ? tunnelSum : null);

    // ── Interface + VPN tables (walk in parallel) ───────────────
    const [ifNames, ifStatuses, ifHighSpeeds, ifInHC, ifOutHC, ifAliases, ifIn32, ifOut32,
           vpnUsers, vpnSrcIps, vpnTunIps, vpnDurations] = await Promise.all([
      snmpWalk(session, OID.ifName),
      snmpWalk(session, OID.ifOperStatus),
      snmpWalk(session, OID.ifHighSpeed),
      snmpWalk(session, OID.ifHCInOctets),
      snmpWalk(session, OID.ifHCOutOctets),
      snmpWalk(session, OID.ifAlias),
      snmpWalk(session, OID.ifInOctets),
      snmpWalk(session, OID.ifOutOctets),
      snmpWalk(session, OID.fgVpnSslTunnelUser),
      snmpWalk(session, OID.fgVpnSslTunnelSrcIp),
      snmpWalk(session, OID.fgVpnSslTunnelIp),
      snmpWalk(session, OID.fgVpnSslTunnelDuration),
    ]);

    // Build SSL-VPN user list — match by OID index suffix, not array position
    const vpnByIdx = {};
    vpnUsers.forEach(r => {
      const i = r.oid.split('.').pop();
      vpnByIdx[i] = { user: String(r.value).trim() };
    });
    vpnSrcIps.forEach(r => {
      const i = r.oid.split('.').pop();
      if (vpnByIdx[i]) vpnByIdx[i].src_ip = String(r.value).trim();
    });
    vpnTunIps.forEach(r => {
      const i = r.oid.split('.').pop();
      if (vpnByIdx[i]) vpnByIdx[i].vpn_ip = String(r.value).trim();
    });
    vpnDurations.forEach(r => {
      const i = r.oid.split('.').pop();
      if (vpnByIdx[i]) vpnByIdx[i].duration_s = parseInt(r.value) || 0;
    });
    const vpnSslUsers = Object.values(vpnByIdx).filter(u => u.user);

    // Build index map keyed by interface index
    const byIdx = {};
    ifNames.forEach(r => {
      const i = idx(r.oid, OID.ifName);
      byIdx[i] = { ifIndex: i, name: String(r.value).trim() };
    });
    ifStatuses.forEach(r => {
      const i = idx(r.oid, OID.ifOperStatus);
      if (byIdx[i]) byIdx[i].link = parseInt(r.value) === 1;
    });
    ifHighSpeeds.forEach(r => {
      const i = idx(r.oid, OID.ifHighSpeed);
      if (byIdx[i]) byIdx[i].speed = parseInt(r.value) || null;
    });
    ifInHC.forEach(r => {
      const i = idx(r.oid, OID.ifHCInOctets);
      const v = parseInt(r.value) || 0;
      if (byIdx[i]) byIdx[i].rx_bytes = v;
    });
    ifOutHC.forEach(r => {
      const i = idx(r.oid, OID.ifHCOutOctets);
      const v = parseInt(r.value) || 0;
      if (byIdx[i]) byIdx[i].tx_bytes = v;
    });
    // Counter32 fallback — only use if HC counter is zero or missing
    ifIn32.forEach(r => {
      const i = idx(r.oid, OID.ifInOctets);
      const v = parseInt(r.value) || 0;
      if (byIdx[i] && !byIdx[i].rx_bytes && v > 0) byIdx[i].rx_bytes = v;
    });
    ifOut32.forEach(r => {
      const i = idx(r.oid, OID.ifOutOctets);
      const v = parseInt(r.value) || 0;
      if (byIdx[i] && !byIdx[i].tx_bytes && v > 0) byIdx[i].tx_bytes = v;
    });
    ifAliases.forEach(r => {
      const i = idx(r.oid, OID.ifAlias);
      if (byIdx[i] && r.value && String(r.value).trim()) {
        byIdx[i].alias = String(r.value).trim();
      }
    });

    // IP address → interface index mapping
    const [ipAddrs, ipIdxs] = await Promise.all([
      snmpWalk(session, OID.ipAdEntAddr),
      snmpWalk(session, OID.ipAdEntIfIndex),
    ]);
    const ipByIfIdx = {};
    ipAddrs.forEach((r) => {
      const ip4 = String(r.value);
      // Find matching ifIndex entry
      const matchingIdx = ipIdxs.find(x => {
        // The IP address is encoded in the OID suffix
        const suffix = r.oid.replace(OID.ipAdEntAddr + '.', '');
        const idxSuffix = x.oid.replace(OID.ipAdEntIfIndex + '.', '');
        return suffix === idxSuffix;
      });
      if (matchingIdx) {
        const ifIdxVal = String(parseInt(matchingIdx.value));
        if (!ipByIfIdx[ifIdxVal]) ipByIfIdx[ifIdxVal] = [];
        ipByIfIdx[ifIdxVal].push(ip4);
      }
    });
    Object.keys(byIdx).forEach(i => {
      const ips = ipByIfIdx[i] || [];
      byIdx[i].ip = ips.find(ip4 => ip4 !== '0.0.0.0' && !ip4.startsWith('169.254')) || null;
    });

    // Filter interfaces — based on real FortiGate-100F interface names
    // These are internal FortiGate pseudo-interfaces that should never be shown:
    const SKIP_EXACT = new Set([
      'ssl.root', 'wqt.root', 'naf.root', 'l2t.root',
      'fortilink', '_default', 'nac_segment', 'rspan',
      'onboarding', 'quarantine', 'ha1', 'ha2', 'modem',
      'SoftSW_Test',
    ]);
    const SKIP_PREFIX = ['wqtn.', 'nac_segment.'];

    const interfaces = Object.values(byIdx)
      .filter(i => {
        if (!i.name) return false;
        if (i.name.startsWith('lo')) return false;
        // Skip 169.254 link-local
        if (i.ip && i.ip.startsWith('169.254')) return false;
        // Skip exact matches
        if (SKIP_EXACT.has(i.name)) return false;
        // Skip by prefix
        if (SKIP_PREFIX.some(p => i.name.startsWith(p))) return false;
        // Hide DOWN ports with no IP (unconnected physical ports)
        if (!i.link && !i.ip && /^port\d+$/.test(i.name)) return false;
        return true;
      })
      .map(i => ({
        name:     i.name,
        ifName:   i.alias && i.alias !== i.name ? i.alias : i.name,
        ip:       i.ip,
        link:     i.link || false,
        speed:    i.speed || null,
        rx_bytes: i.rx_bytes || 0,
        tx_bytes: i.tx_bytes || 0,
      }))
      .sort((a, b) => {
        // WAN/Internet ports first, then UP, then alphabetical
        const wanScore = n => /^(wan|internet|public|x\d)/i.test(n) ? 0 : 1;
        const wa = wanScore(a.name), wb = wanScore(b.name);
        if (wa !== wb) return wa - wb;
        if (a.link !== b.link) return a.link ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // ── IPSec tunnel count ────────────────────────────────────────
    let ipsecCount = 0;
    try {
      const ipsecStatuses = await snmpWalk(session, OID.fgVpnIpsecStatus);
      ipsecCount = ipsecStatuses.filter(r => parseInt(r.value) === 2).length;
    } catch {}

    session.close();

    const sslCount = vpnSslUsers.length || sslUserCount || 0;

    return {
      brand:    'fortigate',
      connected: true,
      protocol: 'snmp',
      snmp_version: String(cfg.snmp_version || '2c'),
      model:    scalars[OID.sysName] ? String(scalars[OID.sysName]) : (cfg.model || 'FortiGate'),
      hostname: scalars[OID.sysName] ? String(scalars[OID.sysName]) : null,
      version:  null,
      serial:   null,
      uptime:   formatUptime(scalars[OID.sysUpTime]),
      cpu_percent:      cpuPct,
      memory_percent:   memPct,
      memory_total_kb:  memCapKB,
      disk_usage_mb:    null,
      disk_capacity_mb: null,
      disk_percent:     null,
      active_sessions:  sessions,
      ha_mode:          null,
      interfaces,
      vpn_ssl_users: vpnSslUsers,
      vpn_ipsec_tunnels: Array.from({ length: ipsecCount }, (_, i) => ({ name: `Tunnel ${i+1}`, status: 'up' })),
      summary: {
        ssl_vpn_users:   sslCount,
        ipsec_tunnels:   ipsecCount,
        wan_interfaces:  interfaces.filter(i => i.link).length,
        active_sessions: sessions,
      }
    };

  } catch (err) {
    try { session.close(); } catch {}
    return { connected: false, brand: 'fortigate', error: err.message || String(err) };
  }
}

module.exports = { pollFortigate };
