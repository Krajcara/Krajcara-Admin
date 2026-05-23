'use strict';
const db = require('../db/database');

// ── Create notification ───────────────────────────────────────────────────────
function createNotification({ type = 'info', module, title, message, entityId, entityName }) {
  try {
    const r = db.prepare(`
      INSERT INTO notifications (type, module, title, message, entity_id, entity_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, module, title, message || null, entityId ? String(entityId) : null, entityName || null);

    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(r.lastInsertRowid);

    // Emit real-time via Socket.io
    const io = global.io;
    if (io) io.emit('notification:new', notif);

    // Send email if enabled
    sendEmailNotification(notif).catch(e => console.error('[Notifications] Email error:', e.message));

    return notif;
  } catch (e) {
    console.error('[Notifications] createNotification error:', e.message);
    return null;
  }
}

// ── Send email via M365 Graph ─────────────────────────────────────────────────
async function sendEmailNotification(notif) {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='notif_email_enabled'").get()?.value;
  if (enabled !== '1') return;

  const recipients = db.prepare("SELECT value FROM settings WHERE key='notif_email_recipients'").get()?.value;
  if (!recipients) return;

  const tid = db.prepare("SELECT value FROM settings WHERE key='m365_tenant_id'").get()?.value;
  const cid = db.prepare("SELECT value FROM settings WHERE key='m365_client_id'").get()?.value;
  const sec = db.prepare("SELECT value FROM settings WHERE key='m365_client_secret'").get()?.value;
  const sender = db.prepare("SELECT value FROM settings WHERE key='notif_email_sender'").get()?.value;

  if (!tid || !cid || !sec || !sender) return;

  const axios = require('axios');

  // Get M365 token
  const tokenRes = await axios.post(
    `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: cid, client_secret: sec, scope: 'https://graph.microsoft.com/.default' }),
    { timeout: 15000 }
  );
  const token = tokenRes.data.access_token;

  const toAddresses = recipients.split(',').map(e => e.trim()).filter(Boolean).map(e => ({
    emailAddress: { address: e }
  }));

  const typeEmoji = { error: '🔴', warning: '🟡', info: '🔵', success: '🟢' }[notif.type] || '🔵';
  const subject   = `${typeEmoji} [Krajcara Admin] ${notif.title}`;
  const body      = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #1A56A0;">${notif.title}</h2>
      <p><strong>Module:</strong> ${notif.module}</p>
      ${notif.entity_name ? `<p><strong>Item:</strong> ${notif.entity_name}</p>` : ''}
      ${notif.message ? `<p>${notif.message}</p>` : ''}
      <hr style="border: 1px solid #eee; margin: 16px 0;" />
      <p style="color: #888; font-size: 12px;">
        Krajcara Admin · ${new Date(notif.created_at).toLocaleString('en')}
      </p>
    </div>
  `;

  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,
    {
      message: {
        subject,
        body: { contentType: 'HTML', content: body },
        toRecipients: toAddresses,
      },
      saveToSentItems: false,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  console.log(`[Notifications] Email sent: ${subject}`);
}

// ── Trigger checks (called from scheduler) ───────────────────────────────────
async function runNotificationChecks() {
  try {
    checkEntraExpiry();
    checkMonitorsDown();
    await checkRouters();
    await checkDnsServers();
    await checkProxmoxVMs();
  } catch (e) {
    console.error('[Notifications] Check error:', e.message);
  }
}

function checkEntraExpiry() {
  const apps = db.prepare("SELECT * FROM entra_apps WHERE hidden = 0 AND secret_expiry IS NOT NULL").all();
  const now  = new Date();
  for (const app of apps) {
    const days = Math.ceil((new Date(app.secret_expiry) - now) / 86400000);
    if (days <= 0) {
      // Check if we already notified today
      const exists = db.prepare(`
        SELECT id FROM notifications WHERE module='entra' AND entity_id=? AND type='error'
        AND created_at >= datetime('now', '-1 days')
      `).get(String(app.id));
      if (!exists) createNotification({
        type: 'error', module: 'entra',
        title: `Client secret expired: ${app.app_name}`,
        message: `The client secret for ${app.app_name} expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago.`,
        entityId: app.id, entityName: app.app_name,
      });
    } else if (days <= 30) {
      const exists = db.prepare(`
        SELECT id FROM notifications WHERE module='entra' AND entity_id=? AND type='warning'
        AND created_at >= datetime('now', '-3 days')
      `).get(String(app.id));
      if (!exists) createNotification({
        type: 'warning', module: 'entra',
        title: `Client secret expiring: ${app.app_name}`,
        message: `The client secret for ${app.app_name} expires in ${days} day${days !== 1 ? 's' : ''}.`,
        entityId: app.id, entityName: app.app_name,
      });
    }
  }
}

function checkMonitorsDown() {
  const monitors = db.prepare("SELECT * FROM monitors WHERE enabled=1 AND last_status='down'").all();
  for (const m of monitors) {
    const exists = db.prepare(`
      SELECT id FROM notifications WHERE module='monitors' AND entity_id=? AND type='error'
      AND created_at >= datetime('now', '-1 hours')
    `).get(String(m.id));
    if (!exists) createNotification({
      type: 'error', module: 'monitors',
      title: `Monitor down: ${m.label}`,
      message: `${m.target} is not responding.`,
      entityId: m.id, entityName: m.label,
    });
  }
}



// ── Router ping check ─────────────────────────────────────────────────────────
async function checkRouters() {
  const { execSync } = require('child_process');
  const routers = db.prepare('SELECT * FROM routers').all();
  for (const r of routers) {
    let alive = false;
    try {
      execSync(`ping -c 1 -W 3 ${r.ip_address}`, { timeout: 5000 });
      alive = true;
    } catch {}

    const lastStatus = db.prepare(
      "SELECT type FROM notifications WHERE module='routers' AND entity_id=? ORDER BY created_at DESC LIMIT 1"
    ).get(String(r.id));

    if (!alive && lastStatus?.type !== 'error') {
      // Router just went down
      createNotification({
        type: 'error', module: 'routers',
        title: `Router offline: ${r.name}`,
        message: `${r.ip_address} is not responding to ping.`,
        entityId: r.id, entityName: r.name,
      });
    } else if (alive && lastStatus?.type === 'error') {
      // Router recovered
      createNotification({
        type: 'success', module: 'routers',
        title: `Router back online: ${r.name}`,
        message: `${r.ip_address} is responding again.`,
        entityId: r.id, entityName: r.name,
      });
    }
  }
}

// ── DNS server check ──────────────────────────────────────────────────────────
async function checkDnsServers() {
  const { execSync } = require('child_process');
  const servers = db.prepare('SELECT * FROM dns_local').all();
  for (const s of servers) {
    // Extract hostname/IP — strip protocol and port
    const host = s.ip.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    let online = false;
    try {
      execSync(`ping -c 1 -W 3 ${host}`, { timeout: 5000 });
      online = true;
    } catch {}

    const label = s.label || `${s.role} DNS (${s.ip})`;
    const lastStatus = db.prepare(
      "SELECT type FROM notifications WHERE module='dns' AND entity_id=? ORDER BY created_at DESC LIMIT 1"
    ).get(String(s.id));

    if (!online && lastStatus?.type !== 'error') {
      createNotification({
        type: 'error', module: 'dns',
        title: `DNS server offline: ${label}`,
        message: `${s.ip} (${s.role}) is not responding.`,
        entityId: s.id, entityName: label,
      });
    } else if (online && lastStatus?.type === 'error') {
      createNotification({
        type: 'success', module: 'dns',
        title: `DNS server back online: ${label}`,
        message: `${s.ip} (${s.role}) is responding again.`,
        entityId: s.id, entityName: label,
      });
    }
  }
}


// ── Proxmox VM check ──────────────────────────────────────────────────────────
async function checkProxmoxVMs() {
  const url     = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value;
  const tokenId = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
  const user    = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
  const secret  = db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value;
  if (!url || !secret) return;

  const axios      = require('axios');
  const https      = require('https');
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const token      = tokenId ? `${user}!${tokenId}=${secret}` : secret;
  const headers    = { Authorization: `PVEAPIToken=${token}` };
  const opts       = { headers, httpsAgent, timeout: 10000 };

  try {
    const nodesRes = await axios.get(`${url}/api2/json/nodes`, opts);
    const nodes    = nodesRes.data.data || [];

    for (const node of nodes) {
      if (node.status !== 'online') continue;
      const [vmsRes, lxcRes] = await Promise.all([
        axios.get(`${url}/api2/json/nodes/${node.node}/qemu`, opts).catch(() => ({ data: { data: [] } })),
        axios.get(`${url}/api2/json/nodes/${node.node}/lxc`,  opts).catch(() => ({ data: { data: [] } })),
      ]);

      const all = [
        ...(vmsRes.data.data || []).map(v => ({ ...v, type: 'qemu' })),
        ...(lxcRes.data.data || []).map(v => ({ ...v, type: 'lxc' })),
      ];

      for (const vm of all) {
        const entityId  = `${node.node}-${vm.vmid}`;
        const entityName = `${vm.name} (${node.node})`;
        const isRunning  = vm.status === 'running';

        const lastNotif = db.prepare(
          "SELECT type FROM notifications WHERE module='proxmox' AND entity_id=? ORDER BY created_at DESC LIMIT 1"
        ).get(entityId);

        if (!isRunning && lastNotif?.type !== 'error') {
          createNotification({
            type: 'error', module: 'proxmox',
            title: `VM stopped: ${vm.name}`,
            message: `${vm.name} on node ${node.node} is ${vm.status}.`,
            entityId, entityName,
          });
        } else if (isRunning && lastNotif?.type === 'error') {
          createNotification({
            type: 'success', module: 'proxmox',
            title: `VM started: ${vm.name}`,
            message: `${vm.name} on node ${node.node} is running again.`,
            entityId, entityName,
          });
        }
      }
    }
  } catch (e) {
    console.error('[Notifications] Proxmox check error:', e.message);
  }
}

module.exports = { createNotification, runNotificationChecks, checkRouters, checkDnsServers, checkProxmoxVMs };
