const net   = require('net');
const dns   = require('dns').promises;
const axios = require('axios');
const https = require('https');

let db;
try { db = require('../db/database'); } catch {}

const MAX_CONCURRENT = 10;
const timers = new Map();
let running  = 0;

// ── Check functions ───────────────────────────────────────────────────────────

async function checkHttp(monitor) {
  const start = Date.now();
  try {
    let url = monitor.target;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = monitor.type === 'https' ? `https://${url}` : `http://${url}`;
    }
    const agent = url.startsWith('https://')
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
    const res = await axios.get(url, {
      timeout: (monitor.timeout_s || 10) * 1000,
      validateStatus: () => true,
      maxRedirects: 5,
      httpsAgent: agent,
      headers: { 'User-Agent': 'Krajcara-Admin/1.0' }
    });
    const latency_ms   = Date.now() - start;
    const expectedCode = monitor.expected_status || 200;
    const statusOk = res.status === expectedCode
      || (expectedCode === 200 && res.status >= 200 && res.status < 400);
    const keywordOk = !monitor.keyword || String(res.data).includes(monitor.keyword);
    if (!statusOk)  return { status: 'down',     latency_ms, status_code: res.status, error_msg: `HTTP ${res.status} (expected ${expectedCode})` };
    if (!keywordOk) return { status: 'down',     latency_ms, status_code: res.status, error_msg: `Keyword "${monitor.keyword}" not found` };
    const degraded = latency_ms > (monitor.timeout_s || 10) * 800;
    return { status: degraded ? 'degraded' : 'up', latency_ms, status_code: res.status };
  } catch (err) {
    return { status: 'down', latency_ms: Date.now() - start, error_msg: err.message?.substring(0, 200) };
  }
}

async function checkTcp(monitor) {
  const start = Date.now();
  const port  = monitor.port || 80;
  return new Promise(resolve => {
    const socket  = new net.Socket();
    const timeout = (monitor.timeout_s || 10) * 1000;
    socket.setTimeout(timeout);
    socket.connect(port, monitor.target, () => {
      socket.destroy();
      resolve({ status: 'up', latency_ms: Date.now() - start });
    });
    socket.on('error',   (err) => resolve({ status: 'down', latency_ms: Date.now() - start, error_msg: err.message }));
    socket.on('timeout', ()    => { socket.destroy(); resolve({ status: 'down', latency_ms: timeout, error_msg: 'Connection timeout' }); });
  });
}

async function checkIcmp(monitor) {
  const start = Date.now();
  try {
    const { execSync } = require('child_process');
    execSync(`ping -c 1 -W ${monitor.timeout_s || 5} ${monitor.target}`, { timeout: (monitor.timeout_s || 10) * 1000 });
    return { status: 'up', latency_ms: Date.now() - start };
  } catch {
    return { status: 'down', latency_ms: Date.now() - start, error_msg: 'Host not responding to ping' };
  }
}

async function checkDns(monitor) {
  const start = Date.now();
  try {
    await dns.resolve(monitor.target);
    return { status: 'up', latency_ms: Date.now() - start };
  } catch (err) {
    return { status: 'down', latency_ms: Date.now() - start, error_msg: err.message };
  }
}

// ── Run one check ─────────────────────────────────────────────────────────────

async function runCheck(monitor) {
  if (running >= MAX_CONCURRENT) return;
  running++;
  let result;
  try {
    switch (monitor.type) {
      case 'http':
      case 'https': result = await checkHttp(monitor); break;
      case 'tcp':   result = await checkTcp(monitor);  break;
      case 'icmp':  result = await checkIcmp(monitor); break;
      case 'dns':   result = await checkDns(monitor);  break;
      default:      result = { status: 'down', error_msg: `Unknown type: ${monitor.type}` };
    }
  } catch (err) {
    result = { status: 'down', error_msg: err.message };
  } finally {
    running--;
  }

  const prevStatus = monitor.last_status;
  const newStatus  = result.status;

  try {
    db.prepare(`
      INSERT INTO monitor_checks (monitor_id, status, latency_ms, status_code, error_msg, checked_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(monitor.id, newStatus, result.latency_ms || null, result.status_code || null, result.error_msg || null);

    db.prepare(`
      UPDATE monitors SET last_status=?, last_latency_ms=?, last_checked_at=datetime('now') WHERE id=?
    `).run(newStatus, result.latency_ms || null, monitor.id);
  } catch (err) {
    console.error('[Monitor] DB write error:', err.message);
  }

  // Emit real-time via Socket.io
  const io = global.io;
  if (io) {
    io.emit('monitor:status', {
      monitorId:  monitor.id,
      status:     newStatus,
      latency_ms: result.latency_ms,
      checked_at: new Date().toISOString()
    });
    if (prevStatus && prevStatus !== 'unknown' && prevStatus !== newStatus) {
      if (newStatus === 'down') {
        io.emit('monitor:down', { monitorId: monitor.id, label: monitor.label, error: result.error_msg });
        try {
          const { createNotification } = require('./notificationService');
          createNotification({
            type: 'error', module: 'monitors',
            title: `Monitor down: ${monitor.label}`,
            message: `${monitor.target} is not responding. ${result.error_msg || ''}`.trim(),
            entityId: monitor.id, entityName: monitor.label,
          });
        } catch {}
      } else if (newStatus === 'up') {
        io.emit('monitor:up', { monitorId: monitor.id, label: monitor.label });
        try {
          const { createNotification } = require('./notificationService');
          createNotification({
            type: 'success', module: 'monitors',
            title: `Monitor recovered: ${monitor.label}`,
            message: `${monitor.target} is back online.`,
            entityId: monitor.id, entityName: monitor.label,
          });
        } catch {}
      } else if (newStatus === 'degraded') {
        io.emit('monitor:degraded', { monitorId: monitor.id, label: monitor.label, latency: result.latency_ms });
      }
    }
  }
}

// ── Register / unregister / init ──────────────────────────────────────────────

function registerMonitor(monitor) {
  if (timers.has(monitor.id)) clearInterval(timers.get(monitor.id));
  if (!monitor.enabled) return;
  const ms = (parseInt(monitor.interval_s) || 60) * 1000;
  const t  = setInterval(() => {
    try {
      const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitor.id);
      if (m && m.enabled) runCheck(m);
    } catch {}
  }, ms);
  timers.set(monitor.id, t);
  // Run immediately
  setTimeout(() => {
    try {
      const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitor.id);
      if (m && m.enabled) runCheck(m);
    } catch {}
  }, 1500);
}

function unregisterMonitor(monitorId) {
  if (timers.has(monitorId)) { clearInterval(timers.get(monitorId)); timers.delete(monitorId); }
}

function initMonitorWorker() {
  try {
    const monitors = db.prepare('SELECT * FROM monitors WHERE enabled = 1').all();
    for (const m of monitors) registerMonitor(m);
    console.log(`[Monitor] Worker started — ${monitors.length} monitor(s)`);
  } catch (err) {
    console.error('[Monitor] Init error:', err.message);
  }
}

module.exports = { initMonitorWorker, registerMonitor, unregisterMonitor, runCheck };
