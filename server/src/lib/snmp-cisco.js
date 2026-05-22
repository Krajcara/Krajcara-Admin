'use strict';
/**
 * Cisco IOS/IOS-XE SNMP polling
 * Works with any Cisco router/switch that supports standard MIBs
 */

const snmp = require('net-snmp');

const OID = {
  // Standard RFC MIBs — supported by all Cisco devices
  sysDescr:     '1.3.6.1.2.1.1.1.0',
  sysName:      '1.3.6.1.2.1.1.5.0',
  sysUpTime:    '1.3.6.1.2.1.1.3.0',
  sysLocation:  '1.3.6.1.2.1.1.6.0',

  // CPU — Cisco IOS: ciscoProcessMIB
  cpmCPUTotal5sec:  '1.3.6.1.4.1.9.9.109.1.1.1.1.3.1',   // 5-sec CPU %
  cpmCPUTotal1min:  '1.3.6.1.4.1.9.9.109.1.1.1.1.4.1',   // 1-min CPU %
  cpmCPUTotal5min:  '1.3.6.1.4.1.9.9.109.1.1.1.1.5.1',   // 5-min CPU %

  // Memory — Cisco IOS: ciscoMemoryPool
  memPoolName:  '1.3.6.1.4.1.9.9.48.1.1.1.2',
  memPoolUsed:  '1.3.6.1.4.1.9.9.48.1.1.1.5',
  memPoolFree:  '1.3.6.1.4.1.9.9.48.1.1.1.6',

  // Interfaces (standard IF-MIB)
  ifName:        '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias:       '1.3.6.1.2.1.31.1.1.1.18',
  ifOperStatus:  '1.3.6.1.2.1.2.2.1.8',
  ifHighSpeed:   '1.3.6.1.2.1.31.1.1.1.15',
  ifHCInOctets:  '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifInOctets:    '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets:   '1.3.6.1.2.1.2.2.1.16',

  // IP addresses
  ipAdEntAddr:    '1.3.6.1.2.1.4.20.1.1',
  ipAdEntIfIndex: '1.3.6.1.2.1.4.20.1.2',
};

function buildSession(ip, cfg) {
  const port = parseInt(cfg.snmp_port) || 161;
  const v = String(cfg.snmp_version || '2c');
  if (v === '3') {
    const level = cfg.snmp_security_level || 'authPriv';
    const authProto = cfg.snmp_auth_protocol === 'MD5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha;
    const privProto = cfg.snmp_priv_protocol === 'DES' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes;
    const user = {
      name: cfg.snmp_username || 'snmpv3user',
      level: level === 'noAuthNoPriv' ? snmp.SecurityLevel.noAuthNoPriv
           : level === 'authNoPriv'   ? snmp.SecurityLevel.authNoPriv
           : snmp.SecurityLevel.authPriv,
    };
    if (level !== 'noAuthNoPriv') { user.authProtocol = authProto; user.authKey = cfg.snmp_auth_password || ''; }
    if (level === 'authPriv')     { user.privProtocol = privProto; user.privKey = cfg.snmp_priv_password || ''; }
    return snmp.createV3Session(ip, user, { port, timeout: 8000, retries: 1, version: snmp.Version3 });
  }
  const community = cfg.snmp_community || 'public';
  const version = v === '1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(ip, community, { port, timeout: 8000, retries: 1, version });
}

function snmpGet(session, oids) {
  return new Promise(resolve => {
    session.get(oids, (err, varbinds) => {
      const out = {};
      if (!err) varbinds.forEach((vb, i) => {
        if (!snmp.isVarbindError(vb)) {
          const v = vb.value;
          out[oids[i]] = Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g, '') : v;
        }
      });
      resolve(out);
    });
  });
}

function snmpWalk(session, rootOid) {
  return new Promise(resolve => {
    const results = [];
    session.subtree(rootOid, 50, (varbinds) => {
      varbinds.forEach(vb => {
        if (!snmp.isVarbindError(vb)) {
          const v = vb.value;
          results.push({ oid: vb.oid, value: Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g, '') : v });
        }
      });
    }, () => resolve(results));
  });
}

function formatUptime(ticks) {
  if (!ticks) return null;
  const s = Math.floor(parseInt(ticks) / 100);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

async function pollCisco(ip, cfg) {
  const session = buildSession(ip, cfg);
  try {
    const scalars = await snmpGet(session, [OID.sysDescr, OID.sysName, OID.sysUpTime, OID.sysLocation,
      OID.cpmCPUTotal5sec, OID.cpmCPUTotal1min]);

    if (!scalars[OID.sysName] && scalars[OID.cpmCPUTotal5sec] == null) {
      session.close();
      return { connected: false, brand: 'cisco', error: 'SNMP timeout — check IP, community string, and that SNMP is enabled on the router (snmp-server community PUBLIC ro)' };
    }

    const cpu5s = scalars[OID.cpmCPUTotal5sec] != null ? parseInt(scalars[OID.cpmCPUTotal5sec]) : null;
    const cpu1m = scalars[OID.cpmCPUTotal1min] != null ? parseInt(scalars[OID.cpmCPUTotal1min]) : null;

    // Memory pools
    const [memNames, memUsed, memFree] = await Promise.all([
      snmpWalk(session, OID.memPoolName),
      snmpWalk(session, OID.memPoolUsed),
      snmpWalk(session, OID.memPoolFree),
    ]);

    let memPct = null, memTotalBytes = null, memUsedBytes = null;
    // Find "Processor" pool (index 1)
    const processorPool = memNames.find(r => String(r.value).toLowerCase().includes('processor'));
    if (processorPool) {
      const idx = processorPool.oid.split('.').pop();
      const usedEntry = memUsed.find(r => r.oid.endsWith('.' + idx));
      const freeEntry = memFree.find(r => r.oid.endsWith('.' + idx));
      if (usedEntry && freeEntry) {
        const u = parseInt(usedEntry.value) || 0;
        const f = parseInt(freeEntry.value) || 0;
        const t = u + f;
        memUsedBytes = u; memTotalBytes = t;
        memPct = t > 0 ? Math.round((u / t) * 100) : null;
      }
    } else if (memUsed.length > 0 && memFree.length > 0) {
      // Fallback: use first pool
      const u = parseInt(memUsed[0].value) || 0;
      const f = parseInt(memFree[0].value) || 0;
      const t = u + f;
      memUsedBytes = u; memTotalBytes = t;
      memPct = t > 0 ? Math.round((u / t) * 100) : null;
    }

    // Interfaces
    const [ifNames, ifAliases, ifStatuses, ifSpeeds, ifInHC, ifOutHC, ifIn32, ifOut32] = await Promise.all([
      snmpWalk(session, OID.ifName),
      snmpWalk(session, OID.ifAlias),
      snmpWalk(session, OID.ifOperStatus),
      snmpWalk(session, OID.ifHighSpeed),
      snmpWalk(session, OID.ifHCInOctets),
      snmpWalk(session, OID.ifHCOutOctets),
      snmpWalk(session, OID.ifInOctets),
      snmpWalk(session, OID.ifOutOctets),
    ]);

    const byIdx = {};
    ifNames.forEach(r => { const i = r.oid.replace(OID.ifName + '.', ''); byIdx[i] = { name: String(r.value).trim() }; });
    ifAliases.forEach(r => { const i = r.oid.replace(OID.ifAlias + '.', ''); if (byIdx[i] && r.value) byIdx[i].alias = String(r.value).trim(); });
    ifStatuses.forEach(r => { const i = r.oid.replace(OID.ifOperStatus + '.', ''); if (byIdx[i]) byIdx[i].link = parseInt(r.value) === 1; });
    ifSpeeds.forEach(r => { const i = r.oid.replace(OID.ifHighSpeed + '.', ''); if (byIdx[i]) byIdx[i].speed = parseInt(r.value) || null; });
    ifInHC.forEach(r => { const i = r.oid.replace(OID.ifHCInOctets + '.', ''); if (byIdx[i]) byIdx[i].rx_bytes = parseInt(r.value) || 0; });
    ifOutHC.forEach(r => { const i = r.oid.replace(OID.ifHCOutOctets + '.', ''); if (byIdx[i]) byIdx[i].tx_bytes = parseInt(r.value) || 0; });
    ifIn32.forEach(r => { const i = r.oid.replace(OID.ifInOctets + '.', ''); if (byIdx[i] && byIdx[i].rx_bytes == null) byIdx[i].rx_bytes = parseInt(r.value) || 0; });
    ifOut32.forEach(r => { const i = r.oid.replace(OID.ifOutOctets + '.', ''); if (byIdx[i] && byIdx[i].tx_bytes == null) byIdx[i].tx_bytes = parseInt(r.value) || 0; });

    // IPs
    const [ipAddrs, ipIdxs] = await Promise.all([snmpWalk(session, OID.ipAdEntAddr), snmpWalk(session, OID.ipAdEntIfIndex)]);
    const ipByIfIdx = {};
    ipAddrs.forEach(r => {
      const suffix = r.oid.replace(OID.ipAdEntAddr + '.', '');
      const match = ipIdxs.find(x => x.oid.replace(OID.ipAdEntIfIndex + '.', '') === suffix);
      if (match) {
        const k = String(parseInt(match.value));
        if (!ipByIfIdx[k]) ipByIfIdx[k] = [];
        ipByIfIdx[k].push(String(r.value));
      }
    });
    Object.keys(byIdx).forEach(i => {
      const ips = ipByIfIdx[i] || [];
      byIdx[i].ip = ips.find(ip => ip !== '0.0.0.0' && !ip.startsWith('169.254')) || null;
    });

    const SKIP = ['Nu', 'Lo', 'Vl', 'Tu'];
    const interfaces = Object.values(byIdx)
      .filter(i => i.name && !SKIP.some(p => i.name.startsWith(p)))
      .map(i => ({
        name: i.name, ifName: i.alias && i.alias !== i.name ? `${i.name} (${i.alias})` : i.name,
        ip: i.ip, link: i.link || false, speed: i.speed, rx_bytes: i.rx_bytes || 0, tx_bytes: i.tx_bytes || 0,
      }))
      .sort((a, b) => { if (a.link !== b.link) return a.link ? -1 : 1; return a.name.localeCompare(b.name); });

    session.close();
    return {
      brand: 'cisco', connected: true, protocol: 'snmp',
      model: scalars[OID.sysName] ? String(scalars[OID.sysName]) : (cfg.model || 'Cisco'),
      hostname: scalars[OID.sysName] ? String(scalars[OID.sysName]) : null,
      uptime: formatUptime(scalars[OID.sysUpTime]),
      cpu_percent: cpu5s ?? cpu1m,
      memory_percent: memPct, memory_used: memUsedBytes, memory_total: memTotalBytes,
      interfaces,
      summary: { wan_interfaces: interfaces.filter(i => i.link).length },
    };
  } catch (err) {
    try { session.close(); } catch {}
    return { connected: false, brand: 'cisco', error: err.message || String(err) };
  }
}

module.exports = { pollCisco };
