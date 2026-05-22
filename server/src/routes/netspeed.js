'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

function getConfig() {
  const url      = db.prepare("SELECT value FROM settings WHERE key='myspeed_url'").get()?.value || '';
  const password = db.prepare("SELECT value FROM settings WHERE key='myspeed_password'").get()?.value || '';
  return { url: url.replace(/\/$/, ''), password };
}

function buildHeaders(password) {
  return password ? { Authorization: password } : {};
}

// GET /api/netspeed/config
router.get('/config', (req, res) => {
  const url      = db.prepare("SELECT value FROM settings WHERE key='myspeed_url'").get()?.value || '';
  const hasPass  = !!(db.prepare("SELECT value FROM settings WHERE key='myspeed_password'").get()?.value);
  res.json({ configured: !!url, url, hasPassword: hasPass });
});

// POST /api/netspeed/config
router.post('/config', requireRole('superadmin', 'admin'), (req, res) => {
  const { url, password } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'URL is required' });
  db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('myspeed_url',?,datetime('now'))").run(url.trim().replace(/\/$/, ''));
  if (password && password !== '***') {
    db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('myspeed_password',?,datetime('now'))").run(password);
  }
  res.json({ ok: true });
});

// GET /api/netspeed/tests?limit=N — latest tests
router.get('/tests', async (req, res) => {
  const cfg   = getConfig();
  if (!cfg.url) return res.status(503).json({ error: 'MySpeed not configured' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const r = await axios.get(`${cfg.url}/api/speedtests?limit=${limit}`, {
      headers: buildHeaders(cfg.password), timeout: 10000
    });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 503;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/netspeed/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/statistics', async (req, res) => {
  const cfg = getConfig();
  if (!cfg.url) return res.status(503).json({ error: 'MySpeed not configured' });

  // Default: last 30 days
  const to   = req.query.to   || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  try {
    const r = await axios.get(`${cfg.url}/api/speedtests/statistics?from=${from}&to=${to}`, {
      headers: buildHeaders(cfg.password), timeout: 10000
    });
    res.json(r.data);
  } catch (err) {
    // Fallback: calculate stats ourselves from recent tests
    try {
      const tests = await axios.get(`${cfg.url}/api/speedtests?limit=200`, {
        headers: buildHeaders(cfg.password), timeout: 10000
      });
      const items = (Array.isArray(tests.data) ? tests.data : []).filter(t => !t.error);
      const calc  = (arr, key) => {
        const vals = arr.map(t => t[key]).filter(v => v != null && v > 0);
        if (!vals.length) return { min: null, max: null, avg: null };
        return {
          min: Math.round(Math.min(...vals) * 100) / 100,
          max: Math.round(Math.max(...vals) * 100) / 100,
          avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
        };
      };
      res.json({ download: calc(items, 'download'), upload: calc(items, 'upload'), ping: calc(items, 'ping') });
    } catch (err2) {
      res.status(503).json({ error: err2.message });
    }
  }
});

// GET /api/netspeed/status
router.get('/status', async (req, res) => {
  const cfg = getConfig();
  if (!cfg.url) return res.json({ configured: false });
  try {
    const r = await axios.get(`${cfg.url}/api/speedtests/status`, {
      headers: buildHeaders(cfg.password), timeout: 5000
    });
    res.json({ configured: true, ...r.data });
  } catch {
    res.json({ configured: true, running: false, paused: false, unreachable: true });
  }
});

// POST /api/netspeed/run — trigger a new speedtest
router.post('/run', requireRole('superadmin', 'admin', 'operator'), async (req, res) => {
  const cfg = getConfig();
  if (!cfg.url) return res.status(503).json({ error: 'MySpeed not configured' });
  try {
    const r = await axios.post(`${cfg.url}/api/speedtests/run`, {}, {
      headers: buildHeaders(cfg.password), timeout: 10000
    });
    res.json(r.data);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(err.response?.status || 503).json({ error: msg });
  }
});

module.exports = router;
