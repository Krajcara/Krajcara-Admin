'use strict';
const { spawn } = require('child_process');
const xml2js    = require('xml2js');

const FORBIDDEN = [
  /--script\s+.*exec/i, /--script\s+.*brute/i, /--script\s+.*exploit/i,
  /--datadir/i, /--servicedb/i, /-oN/i, /-oX/i, /-oG/i, /-oA/i,
  /[;&|`$(){}[\]]/
];

function validateNmapArgs(args) {
  for (const p of FORBIDDEN) {
    if (p.test(args)) throw new Error(`Forbidden nmap argument: ${args}`);
  }
  return true;
}

function parseNmapXml(xmlData) {
  return new Promise((resolve, reject) => {
    let xml = xmlData;
    if (!xml.includes('</nmaprun>')) {
      if (xml.includes('<host ') && !xml.match(/<\/host>\s*<\/nmaprun>/)) {
        if (!xml.trimEnd().endsWith('</host>')) xml += '\n</host>';
      }
      xml += '\n</nmaprun>';
    }
    xml2js.parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) return reject(new Error('XML parse error: ' + err.message));
      const hosts = [];
      const raw = result?.nmaprun?.host;
      if (!raw) return resolve(hosts);
      const list = Array.isArray(raw) ? raw : [raw];
      for (const h of list) {
        const addresses = Array.isArray(h.address) ? h.address : (h.address ? [h.address] : []);
        let ip = null, mac = null;
        for (const a of addresses) {
          if (a.$?.addrtype === 'ipv4' || a.$?.addrtype === 'ipv6') ip = a.$?.addr;
          if (a.$?.addrtype === 'mac') mac = a.$?.addr;
        }
        const hnRaw = h.hostnames?.hostname;
        let hostname = null;
        if (hnRaw) {
          const hnList = Array.isArray(hnRaw) ? hnRaw : [hnRaw];
          hostname = hnList.find(x => x.$?.type === 'PTR')?.$.name || hnList[0]?.$?.name || null;
        }
        let os_guess = null, os_accuracy = null;
        const osm = h.os?.osmatch;
        if (osm) {
          const best = Array.isArray(osm) ? osm[0] : osm;
          os_guess = best?.$?.name || null;
          os_accuracy = parseInt(best?.$?.accuracy) || null;
        }
        const ports = [];
        const portData = h.ports?.port;
        if (portData) {
          const portList = Array.isArray(portData) ? portData : [portData];
          for (const p of portList) {
            ports.push({
              port_number: parseInt(p.$?.portid),
              protocol:    p.$?.protocol || 'tcp',
              state:       p.state?.$?.state || 'unknown',
              service:     p.service?.$?.name || null,
              product:     p.service?.$?.product || null,
              version:     p.service?.$?.version || null,
              extra_info:  p.service?.$?.extrainfo || null,
            });
          }
        }
        hosts.push({ ip, mac, hostname, status: h.status?.$?.state || 'unknown', os_guess, os_accuracy, ports });
      }
      resolve(hosts);
    });
  });
}

function runNmap(target, nmapArgs, onProgress) {
  return new Promise((resolve, reject) => {
    validateNmapArgs(nmapArgs);
    const args = [...nmapArgs.trim().split(/\s+/), '-oX', '-', target];
    const timeoutMs = (parseInt(process.env.SCAN_TIMEOUT_SECONDS) || 600) * 1000;
    const proc = spawn('nmap', args, { timeout: timeoutMs });
    let xmlBuf = '', stderrBuf = '';
    proc.stdout.on('data', d => { xmlBuf += d.toString(); });
    proc.stderr.on('data', d => {
      const text = d.toString(); stderrBuf += text;
      const m = text.match(/About (\d+\.\d+)% done/);
      if (m && onProgress) onProgress(parseFloat(m[1]));
    });
    proc.on('close', async (code) => {
      if (code !== 0 && !xmlBuf.includes('<nmaprun')) {
        return reject(new Error(`nmap error (code ${code}): ${stderrBuf.substring(0, 300)}`));
      }
      try { resolve(await parseNmapXml(xmlBuf)); }
      catch (e) { reject(new Error('XML parse error: ' + e.message)); }
    });
    proc.on('error', err => reject(new Error('nmap not found: ' + err.message)));
  });
}

module.exports = { runNmap, validateNmapArgs };
