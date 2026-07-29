'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { createSession, writeToSession, resizeSession, closeSession } = require('../services/terminalService');
const { v4: uuidv4 } = require('uuid');

router.use(requireAuth);

// GET /api/terminal/token/:serverId — issue short-lived terminal token
router.get('/token/:serverId', (req, res) => {
  const srv = db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(req.params.serverId);
  if (!srv) return res.status(404).json({ error: 'Server not found' });
  if (!srv.enabled) return res.status(400).json({ error: 'Server disabled' });

  const token      = uuidv4();
  const sessionId  = uuidv4();

  // Store token temporarily (5 min TTL via in-memory map)
  pendingTokens.set(token, {
    sessionId,
    serverId: srv.id,
    expires:  Date.now() + 5 * 60 * 1000,
  });

  res.json({ token, sessionId });
});


// ── Pending tokens (in-memory, short TTL) ────────────────────────────────────
const pendingTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingTokens) if (v.expires < now) pendingTokens.delete(k);
}, 60000);

// ── WebSocket handler — called from index.js ──────────────────────────────────
async function handleTerminalWS(ws, req, db) {
  const params   = new URL(req.url, 'http://x').searchParams;
  const token    = params.get('token');
  const cols     = parseInt(params.get('cols') || '220');
  const rows     = parseInt(params.get('rows') || '50');

  const pending = pendingTokens.get(token);
  if (!pending || pending.expires < Date.now()) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
    ws.close();
    return;
  }
  pendingTokens.delete(token);

  const { sessionId, serverId } = pending;
  const srv = db.prepare('SELECT * FROM ssh_servers WHERE id=?').get(serverId);
  if (!srv) { ws.send(JSON.stringify({ type: 'error', message: 'Server not found' })); ws.close(); return; }

  const sshConfig = {
    host:         srv.ip_address,
    port:         srv.ssh_port || 22,
    username:     srv.ssh_user,
    readyTimeout: 15000,
  };

  if (srv.ssh_key) {
    sshConfig.privateKey = srv.ssh_key;
    if (srv.ssh_passphrase) sshConfig.passphrase = srv.ssh_passphrase;
  } else if (srv.ssh_password) {
    sshConfig.password = srv.ssh_password;
  }

  try {
    ws.send(JSON.stringify({ type: 'info', message: `Connecting to ${srv.name} (${srv.ip_address})...\r\n` }));
    await createSession(sessionId, { ...sshConfig, cols, rows }, ws);
    ws.send(JSON.stringify({ type: 'connected', sessionId }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: `Connection failed: ${e.message}` }));
    ws.close();
    return;
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input')  writeToSession(sessionId, msg.data);
      if (msg.type === 'resize') resizeSession(sessionId, msg.cols, msg.rows);
      if (msg.type === 'ping')   ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });

  ws.on('close', () => closeSession(sessionId));
  ws.on('error', () => closeSession(sessionId));
}

module.exports = { router, handleTerminalWS, pendingTokens };
