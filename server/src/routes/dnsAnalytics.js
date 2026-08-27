'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function getServer(id) {
  return db.prepare('SELECT * FROM dns_local WHERE id = ?').get(id);
}

// GET /api/dns/analytics/stats
router.get('/stats', async (req, res) => {
  const { serverId, period = 'LastDay' } = req.query;
  if (!serverId) return res.status(400).json({ error: 'serverId required' });
  const server = getServer(serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  try {
    const r = await axios.get(
      `${server.ip}/api/dashboard/stats/get?token=${server.api_key}&type=${period}`,
      { timeout: 15000, httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) }
    );
    res.json(r.data.response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dns/analytics/top
router.get('/top', async (req, res) => {
  const { serverId, period = 'LastDay', type = 'TopDomains', limit = 10 } = req.query;
  if (!serverId) return res.status(400).json({ error: 'serverId required' });
  const server = getServer(serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  try {
    const r = await axios.get(
      `${server.ip}/api/dashboard/stats/getTop?token=${server.api_key}&type=${period}&statsType=${type}&limit=${limit}`,
      { timeout: 15000, httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) }
    );
    res.json(r.data.response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
