'use strict';
/**
 * MikroTik SNMP polling
 * MikroTik supports SNMP v1/v2c/v3 — enable in: IP → SNMP
 * Uses standard MIBs + MikroTik enterprise OIDs (1.3.6.1.4.1.14988)
 */

const snmp = require('net-snmp');

const OID = {
  // Standard
  sysDescr:     '1.3.6.1.2.1.1.1.0',
  sysName:      '1.3.6.1.2.1.1.5.0',
  sysUpTime:    '1.3.6.1.2.1.1.3.0',

  // MikroTik enterprise MIB (1.3.6.1.4.1.14988.1)
  mtCPUFrequency: '1.3.6.1.4.1.14988.1.1.3.11.0',  // CPU freq MHz
  mtCPULoad:      '1.3.6.1.4.1.14988.1.1.3.14.0',  // CPU load %
  mtTotalMem:     '1.3.6.1.4.1.14988.1.1.3.9.0',   // Total RAM bytes
  mtFreeMem:      '1.3.6.1.4.1.14988.1.1.3.8.0',   // Free RAM bytes
  mtTotalHDD:     '1.3.6.1.4.1.14988.1.1.3.10.0',  // Total disk
  mtFreeHDD:      '1.3.6.1.4.1.14988.1.1.3.11.0',  // Free disk
  mtFirmware:     '1.3.6.1.4.1.14988.1.1.4.4.0',   // RouterOS version
  mtSerialNumber: '1.3.6.1.4.1.14988.1.1.7.3.0',   // Serial number
  mtModel:        '1.3.6.1.4.1.14988.1.1.7.8.0',   // Board model

  // DHCP leases (MikroTik MIB)
  mtDHCPLeaseAddr:   '1.3.6.1.4.1.14988.1.1.6.1.1.2',
  mtDHCPLeaseMAC:    '1.3.6.1.4.1.14988.1.1.6.1.1.3',
  mtDHCPLeaseHostname:'1.3.6.1.4.1.14988.1.1.6.1.1.4',
  mtDHCPLeaseStatus: '1.3.6.1.4.1.14988.1.1.6.1.1.6',

  // Interfaces (standard IF-MIB)
  ifName:        '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias:       '1.3.6.1.2.1.31.1.1.1.18',
  ifOperStatus:  '1.3.6.1.2.1.2.2.1.8',
  ifHighSpeed:   '1.3.6.1.2.1.31.1.1.1.15',
  ifHCInOctets:  '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifInOctets:    '1.3.6.1.2.1.2.2.1.10',
  ifOutOctets:   '1.3.6.1.2.1.2.2.1.16',

  // IP table
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

async function pollMikrotikSnmp(ip, cfg) {
  const session = buildSession(ip, cfg);
  try {
    const scalars = await snmpGet(session, [
      OID.sysDescr, OID.sysName, OID.sysUpTime,
      OID.mtCPULoad, OID.mtTotalMem, OID.mtFreeMem,
      OID.mtFirmware, OID.mtSerialNumber, OID.mtModel,
    ]);

    if (!scalars[OID.sysName] && scalars[OID.mtCPULoad] == null) {
      session.close();
      return { connected: false, brand: 'mikrotik', error: 'SNMP timeout — enable SNMP on MikroTik: IP → SNMP → enable' };
    }

    const totalMem = scalars[OID.mtTotalMem] != null ? parseInt(scalars[OID.mtTotalMem]) : null;
    const freeMem  = scalars[OID.mtFreeMem]  != null ? parseInt(scalars[OID.mtFreeMem])  : null;
    const usedMem  = totalMem != null && freeMem != null ? totalMem - freeMem : null;
    const memPct   = totalMem > 0 && usedMem != null ? Math.round((usedMem / totalMem) * 100) : null;
    const cpuPct   = scalars[OID.mtCPULoad] != null ? parseInt(scalars[OID.mtCPULoad]) : null;

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
      if (match) { const k = String(parseInt(match.value)); if (!ipByIfIdx[k]) ipByIfIdx[k] = []; ipByIfIdx[k].push(String(r.value)); }
    });
    Object.keys(byIdx).forEach(i => {
      byIdx[i].ip = (ipByIfIdx[i] || []).find(ip => ip !== '0.0.0.0' && !ip.startsWith('169.254')) || null;
    });

    // DHCP leases
    const [leaseAddrs, leaseMACs, leaseHosts, leaseStatuses] = await Promise.all([
      snmpWalk(session, OID.mtDHCPLeaseAddr),
      snmpWalk(session, OID.mtDHCPLeaseMAC),
      snmpWalk(session, OID.mtDHCPLeaseHostname),
      snmpWalk(session, OID.mtDHCPLeaseStatus),
    ]);
    const leaseByIdx = {};
    leaseAddrs.forEach(r  => { const i = r.oid.split('.').pop(); leaseByIdx[i] = { ip: String(r.value) }; });
    leaseMACs.forEach(r   => { const i = r.oid.split('.').pop(); if (leaseByIdx[i]) leaseByIdx[i].mac = String(r.value); });
    leaseHosts.forEach(r  => { const i = r.oid.split('.').pop(); if (leaseByIdx[i]) leaseByIdx[i].hostname = String(r.value); });
    leaseStatuses.forEach(r => { const i = r.oid.split('.').pop(); if (leaseByIdx[i]) leaseByIdx[i].status = parseInt(r.value) === 1 ? 'bound' : 'waiting'; });
    const dhcp_leases = Object.values(leaseByIdx).filter(l => l.status === 'bound' && l.ip && l.ip !== '0.0.0.0');

    const SKIP = ['lo', 'bridge-local'];
    const interfaces = Object.values(byIdx)
      .filter(i => i.name && !SKIP.includes(i.name))
      .map(i => ({
        name: i.name, ifName: i.alias && i.alias !== i.name ? `${i.name} (${i.alias})` : i.name,
        ip: i.ip, link: i.link || false, speed: i.speed, rx_bytes: i.rx_bytes || 0, tx_bytes: i.tx_bytes || 0,
      }))
      .sort((a, b) => { if (a.link !== b.link) return a.link ? -1 : 1; return a.name.localeCompare(b.name); });

    session.close();

    const modelName = scalars[OID.mtModel] ? String(scalars[OID.mtModel]) : (cfg.model || 'MikroTik');
    const firmware  = scalars[OID.mtFirmware] ? String(scalars[OID.mtFirmware]) : null;

    return {
      brand: 'mikrotik', connected: true, protocol: 'snmp',
      model: modelName, hostname: scalars[OID.sysName] ? String(scalars[OID.sysName]) : null,
      version: firmware, uptime: formatUptime(scalars[OID.sysUpTime]),
      cpu_percent: cpuPct,
      memory_total: totalMem, memory_used: usedMem, memory_percent: memPct,
      interfaces, dhcp_leases,
      summary: { dhcp_leases: dhcp_leases.length, wan_interfaces: interfaces.filter(i => i.link).length },
    };
  } catch (err) {
    try { session.close(); } catch {}
    return { connected: false, brand: 'mikrotik', error: err.message || String(err) };
  }
}

module.exports = { pollMikrotikSnmp };
