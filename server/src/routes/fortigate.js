'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const https   = require('https');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const agent = new https.Agent({ rejectUnauthorized: false });

function getConfig() {
  const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
  return {
    url:   get('fortigate_url'),
    token: get('fortigate_api_token'),
  };
}

async function fgGet(path) {
  const { url, token } = getConfig();
  if (!url || !token) throw new Error('FortiGate not configured');
  const r = await axios.get(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    httpsAgent: agent,
    timeout: 10000,
  });
  if (r.data.status === 'error') throw new Error(r.data.http_status);
  return r.data.results;
}

// GET /api/fortigate/status
router.get('/status', async (req, res) => {
  try {
    const [perf, ifaces, sessions] = await Promise.all([
      fgGet('/api/v2/monitor/system/performance/status'),
      fgGet('/api/v2/monitor/system/interface?vdom=root'),
      fgGet('/api/v2/monitor/firewall/session?count=1&summary=true'),
    ]);

    // CPU average across cores
    const cores   = perf.cpu?.cores || [];
    const cpuAvg  = cores.length
      ? Math.round(cores.reduce((a, c) => a + (100 - (c.idle || 100)), 0) / cores.length)
      : 0;
    const memPct  = perf.mem?.used_percent || 0;
    const uptime  = perf.uptime || 0;

    // Interfaces with traffic
    const interfaces = (ifaces || [])
      .filter(i => i.rx_bytes > 0 || i.tx_bytes > 0)
      .map(i => ({
        name:     i.name,
        rx_bytes: i.rx_bytes,
        tx_bytes: i.tx_bytes,
        rx_mbps:  i.rx_mbps  || 0,
        tx_mbps:  i.tx_mbps  || 0,
        link:     i.link,
        speed:    i.speed,
      }))
      .sort((a, b) => (b.rx_bytes + b.tx_bytes) - (a.rx_bytes + a.tx_bytes))
      .slice(0, 10);

    res.json({
      cpu_pct:      cpuAvg,
      mem_pct:      memPct,
      uptime,
      sessions:     sessions?.summary?.session_count || 0,
      setup_rate:   sessions?.summary?.setup_rate || 0,
      interfaces,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortigate/sessions
router.get('/sessions', async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 50;
    const data  = await fgGet(`/api/v2/monitor/firewall/session?count=${count}`);
    const sessions = (data?.details || []).map(s => ({
      proto:   s.proto,
      src:     s.saddr,
      src_nat: s.snaddr,
      sport:   s.sport,
      dst:     s.daddr,
      dport:   s.dport,
      country: s.country,
      policy:  s.policyid,
      app:     s.apps?.[0]?.app || null,
      duration: s.duration,
      expiry:  s.expiry,
    }));
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortigate/configured
router.get('/configured', (req, res) => {
  const { url, token } = getConfig();
  res.json({ configured: !!(url && token) });
});

module.exports = router;
