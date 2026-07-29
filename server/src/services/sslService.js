'use strict';
const tls  = require('tls');
const https = require('https');
const { URL } = require('url');
const db   = require('../db/database');

// Check SSL cert expiry for a single URL
function checkSSL(targetUrl, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let hostname, port;
    try {
      const u = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
      if (u.protocol !== 'https:') return resolve({ skip: true });
      hostname = u.hostname;
      port     = parseInt(u.port) || 443;
    } catch {
      return resolve({ error: 'Invalid URL' });
    }

    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ error: 'Timeout' });
    }, timeoutMs);

    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
      clearTimeout(timer);
      try {
        const cert    = socket.getPeerCertificate();
        socket.destroy();
        if (!cert?.valid_to) return resolve({ error: 'No certificate' });
        const expiry  = new Date(cert.valid_to);
        const days    = Math.ceil((expiry - new Date()) / 86400000);
        resolve({ expiry: expiry.toISOString(), days, hostname });
      } catch (e) {
        resolve({ error: e.message });
      }
    });

    socket.on('error', e => { clearTimeout(timer); resolve({ error: e.message }); });
  });
}

// Check all HTTPS monitors and update ssl_expiry / ssl_days
async function checkAllSSL() {
  const monitors = db.prepare(
    "SELECT id, target, type FROM monitors WHERE enabled=1 AND (type='https' OR type='http')"
  ).all();

  for (const m of monitors) {
    try {
      // Only check HTTPS targets
      const url = m.target.startsWith('http') ? m.target : `https://${m.target}`;
      if (!url.startsWith('https')) {
        db.prepare("UPDATE monitors SET ssl_days=NULL, ssl_expiry=NULL, ssl_error='Not HTTPS' WHERE id=?").run(m.id);
        continue;
      }
      const r = await checkSSL(url, 8000);
      if (r.skip) {
        db.prepare("UPDATE monitors SET ssl_days=NULL, ssl_expiry=NULL, ssl_error=NULL WHERE id=?").run(m.id);
      } else if (r.error) {
        db.prepare("UPDATE monitors SET ssl_days=NULL, ssl_expiry=NULL, ssl_error=? WHERE id=?").run(r.error, m.id);
      } else {
        db.prepare("UPDATE monitors SET ssl_days=?, ssl_expiry=?, ssl_error=NULL WHERE id=?").run(r.days, r.expiry, m.id);
      }
    } catch (e) {
      console.error(`[SSL] Monitor ${m.id} error:`, e.message);
    }
  }
  console.log(`[SSL] Checked ${monitors.length} monitors`);
}

// Check single monitor SSL
async function checkMonitorSSL(monitorId) {
  const m = db.prepare('SELECT id, target, type FROM monitors WHERE id=?').get(monitorId);
  if (!m) return;
  const url = m.target.startsWith('http') ? m.target : `https://${m.target}`;
  const r   = await checkSSL(url, 8000);
  if (r.error) {
    db.prepare("UPDATE monitors SET ssl_error=? WHERE id=?").run(r.error, m.id);
  } else if (!r.skip) {
    db.prepare("UPDATE monitors SET ssl_days=?, ssl_expiry=?, ssl_error=NULL WHERE id=?").run(r.days, r.expiry, m.id);
  }
  return r;
}

module.exports = { checkAllSSL, checkMonitorSSL, checkSSL };
