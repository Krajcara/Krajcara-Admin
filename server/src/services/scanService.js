'use strict';
const db = require('../db/database');
const { runNmap } = require('./nmapService');

const MAX_CONCURRENT = parseInt(process.env.SCAN_MAX_CONCURRENT) || 2;
let runningScans = 0;
const queue = [];

function processQueue() {
  while (queue.length > 0 && runningScans < MAX_CONCURRENT) {
    const job = queue.shift();
    runningScans++;
    executeScan(job.scanId)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => { runningScans--; processQueue(); });
  }
}

function enqueueScan(scanId) {
  return new Promise((resolve, reject) => {
    queue.push({ scanId, resolve, reject });
    processQueue();
  });
}

async function executeScan(scanId) {
  const scan = db.prepare('SELECT s.*, h.target FROM scans s JOIN scan_hosts h ON s.host_id = h.id WHERE s.id = ?').get(scanId);
  if (!scan) throw new Error('Scan not found');
  const io = global.io;

  try {
    db.prepare("UPDATE scans SET status='running', started_at=datetime('now') WHERE id=?").run(scanId);
    if (io) io.emit('scan:progress', { scanId, progress: 0, status: 'running' });

    const onProgress = (pct) => {
      const p = Math.round(pct);
      db.prepare('UPDATE scans SET progress=? WHERE id=?').run(p, scanId);
      if (io) io.emit('scan:progress', { scanId, progress: p });
    };

    const results = await runNmap(scan.target, scan.nmap_args || '-T4 -sV', onProgress);

    for (const r of results) {
      const sr = db.prepare(`
        INSERT INTO scan_results (scan_id, ip_address, hostname, mac_address, os_guess, os_accuracy, status)
        VALUES (?,?,?,?,?,?,?)
      `).run(scanId, r.ip, r.hostname, r.mac, r.os_guess, r.os_accuracy, r.status);

      for (const p of r.ports) {
        db.prepare(`
          INSERT INTO port_findings (result_id, port_number, protocol, state, service, product, version, extra_info)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(sr.lastInsertRowid, p.port_number, p.protocol, p.state, p.service, p.product, p.version, p.extra_info);
      }
      if (io) io.emit('scan:result', { scanId, result: { ...r, result_id: sr.lastInsertRowid } });
    }

    db.prepare("UPDATE scans SET status='done', progress=100, finished_at=datetime('now') WHERE id=?").run(scanId);
    if (io) io.emit('scan:complete', { scanId, resultCount: results.length });

    // Check alert rules
    checkAlerts(scan, results);
    return results;
  } catch (err) {
    db.prepare("UPDATE scans SET status='error', error_message=?, finished_at=datetime('now') WHERE id=?").run(err.message, scanId);
    if (io) io.emit('scan:error', { scanId, error: err.message });
    throw err;
  }
}

function checkAlerts(scan, results) {
  try {
    const rules = db.prepare(`
      SELECT * FROM alert_rules WHERE enabled=1 AND (host_id IS NULL OR host_id=?)
    `).all(scan.host_id);

    if (rules.length === 0) return;

    // Get previous scan results for diff
    const prevScan = db.prepare(`
      SELECT id FROM scans WHERE host_id=? AND status='done' AND id<? ORDER BY id DESC LIMIT 1
    `).get(scan.host_id, scan.id);

    for (const rule of rules) {
      let message = null;

      if (rule.trigger_type === 'host_up') {
        const upHosts = results.filter(r => r.status === 'up');
        if (upHosts.length > 0) {
          message = `${upHosts.length} host(s) up: ${upHosts.map(r => r.ip).join(', ')}`;
        }
      } else if (rule.trigger_type === 'host_down') {
        const downHosts = results.filter(r => r.status !== 'up');
        if (downHosts.length > 0) {
          message = `${downHosts.length} host(s) down`;
        }
      } else if (prevScan && rule.trigger_type === 'any_change') {
        // Simple check: port count difference
        const prevResults = db.prepare('SELECT COUNT(*) as cnt FROM port_findings pf JOIN scan_results sr ON pf.result_id=sr.id WHERE sr.scan_id=?').get(prevScan.id);
        const newResults  = db.prepare('SELECT COUNT(*) as cnt FROM port_findings pf JOIN scan_results sr ON pf.result_id=sr.id WHERE sr.scan_id=?').get(scan.id);
        if (prevResults.cnt !== newResults.cnt) {
          message = `Port count changed: ${prevResults.cnt} → ${newResults.cnt}`;
        }
      }

      if (message) {
        db.prepare(`
          INSERT INTO scan_alerts (rule_id, scan_id, type, message, created_at)
          VALUES (?,?,?,?,datetime('now'))
        `).run(rule.id, scan.id, rule.trigger_type, message);

        const io = global.io;
        if (io) io.emit('scan:alert', { ruleId: rule.id, type: rule.trigger_type, message });
      }
    }
  } catch (e) {
    console.error('[ScanAlerts] Error:', e.message);
  }
}

function getQueueStatus() {
  return { running: runningScans, queued: queue.length, maxConcurrent: MAX_CONCURRENT };
}

module.exports = { enqueueScan, getQueueStatus };
