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

module.exports = { createNotification, runNotificationChecks };
