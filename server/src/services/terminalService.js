'use strict';
const { Client } = require('ssh2');

// Active sessions: sessionId -> { conn, stream, ws }
const sessions = new Map();

function createSession(sessionId, sshConfig, ws) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        sessions.set(sessionId, { conn, stream, ws });

        stream.on('data', data => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString('base64') }));
        });

        stream.stderr.on('data', data => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString('base64') }));
        });

        stream.on('close', () => {
          sessions.delete(sessionId);
          try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'closed' })); } catch {}
          conn.end();
        });

        resolve();
      });
    });

    conn.on('error', err => {
      sessions.delete(sessionId);
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message })); } catch {}
      reject(err);
    });

    conn.on('end', () => {
      sessions.delete(sessionId);
    });

    conn.connect(sshConfig);
  });
}

function writeToSession(sessionId, data) {
  const s = sessions.get(sessionId);
  if (s?.stream) s.stream.write(data);
}

function resizeSession(sessionId, cols, rows) {
  const s = sessions.get(sessionId);
  if (s?.stream) s.stream.setWindow(rows, cols, 0, 0);
}

function closeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    try { s.stream?.end(); } catch {}
    try { s.conn?.end();   } catch {}
    sessions.delete(sessionId);
  }
}

function getActiveSessions() { return sessions.size; }

module.exports = { createSession, writeToSession, resizeSession, closeSession, getActiveSessions };
