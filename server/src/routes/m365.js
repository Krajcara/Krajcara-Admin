'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

let tokenCache = { token: null, expires: 0 };

// ── SKU name mapping (key Microsoft SKUs) ─────────────────────────────────────
const SKU_NAMES = {
  'AAD_BASIC':'Microsoft Entra ID Basic','AAD_PREMIUM':'Microsoft Entra ID P1',
  'AAD_PREMIUM_P2':'Microsoft Entra ID P2','ATP_ENTERPRISE':'Microsoft Defender for Office 365 P1',
  'DESKLESSPACK':'Office 365 F3','EMS':'Enterprise Mobility + Security E3',
  'EMSPREMIUM':'Enterprise Mobility + Security E5','ENTERPRISEPACK':'Office 365 E3',
  'ENTERPRISEPREMIUM':'Office 365 E5','EXCHANGEENTERPRISE':'Exchange Online Plan 2',
  'EXCHANGESTANDARD':'Exchange Online Plan 1','FLOW_FREE':'Microsoft Power Automate Free',
  'IDENTITY_THREAT_PROTECTION':'Microsoft 365 E5 Security',
  'INFORMATION_PROTECTION_COMPLIANCE':'Microsoft 365 E5 Compliance',
  'INTUNE_A':'Microsoft Intune','M365_F1':'Microsoft 365 F1',
  'M365_Copilot':'Microsoft Copilot for Microsoft 365',
  'Microsoft_365_Copilot':'Microsoft Copilot for Microsoft 365',
  'Microsoft_365_E3':'Microsoft 365 E3','Microsoft_365_E5':'Microsoft 365 E5',
  'O365_BUSINESS':'Microsoft 365 Apps for Business',
  'O365_BUSINESS_ESSENTIALS':'Microsoft 365 Business Basic',
  'O365_BUSINESS_PREMIUM':'Microsoft 365 Business Standard',
  'OFFICESUBSCRIPTION':'Microsoft 365 Apps for Enterprise',
  'PROJECTPREMIUM':'Project Online Premium','PROJECTPROFESSIONAL':'Project Plan 3',
  'RIGHTSMANAGEMENT':'Azure Information Protection Plan 1',
  'SPB':'Microsoft 365 Business Premium','SPE_E3':'Microsoft 365 E3',
  'SPE_E5':'Microsoft 365 E5','SPZA_IW':'App Connect',
  'STANDARDPACK':'Office 365 E1','STREAM':'Microsoft Stream Plan 2',
  'TEAMS_ESSENTIALS':'Microsoft Teams Essentials',
  'TEAMS_FREE':'Microsoft Teams (Free)','VISIOCLIENT':'Visio Plan 2',
  'WIN10_PRO_ENT_SUB':'Windows 10/11 Enterprise E3',
  'WINDOWS_STORE':'Windows Store for Business',
};

function getSkuName(partNumber) {
  return SKU_NAMES[partNumber] || partNumber;
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────
function getSettings() {
  return {
    client_id:     db.prepare("SELECT value FROM settings WHERE key='m365_client_id'").get()?.value,
    client_secret: db.prepare("SELECT value FROM settings WHERE key='m365_client_secret'").get()?.value,
    tenant_id:     db.prepare("SELECT value FROM settings WHERE key='m365_tenant_id'").get()?.value,
  };
}

async function getM365Token() {
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const s = getSettings();
  if (!s.client_id || !s.client_secret || !s.tenant_id)
    throw new Error('M365 not configured — add Client ID, Client Secret and Tenant ID in Settings');
  const res = await axios.post(
    `https://login.microsoftonline.com/${s.tenant_id}/oauth2/v2.0/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: s.client_id,
      client_secret: s.client_secret, scope: 'https://graph.microsoft.com/.default' }),
    { timeout: 15000 }
  );
  tokenCache.token   = res.data.access_token;
  tokenCache.expires = Date.now() + (res.data.expires_in - 60) * 1000;
  return tokenCache.token;
}

async function graphGet(path, beta = false) {
  const token = await getM365Token();
  const base  = beta ? 'https://graph.microsoft.com/beta' : 'https://graph.microsoft.com/v1.0';
  const res   = await axios.get(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000
  });
  return res.data;
}

// ── Config ────────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    configured:    !!(s.client_id && s.client_secret && s.tenant_id),
    has_client_id: !!s.client_id,
    has_secret:    !!s.client_secret,
    has_tenant:    !!s.tenant_id,
    tenant_id:     s.tenant_id || '',
  });
});

router.post('/config', requireRole('superadmin', 'admin'), (req, res) => {
  const { client_id, client_secret, tenant_id } = req.body;
  const save = (k, v) => {
    if (!v) return;
    db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(k, v);
  };
  save('m365_client_id', client_id);
  save('m365_tenant_id', tenant_id);
  if (client_secret && client_secret !== '***') save('m365_client_secret', client_secret);
  tokenCache = { token: null, expires: 0 };
  res.json({ ok: true });
});

router.post('/refresh-token', (req, res) => {
  tokenCache = { token: null, expires: 0 };
  res.json({ ok: true });
});

// ── Stats overview ────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const usersData = await graphGet('/users?$select=id,accountEnabled,assignedLicenses&$top=999');
    const users     = usersData.value || [];
    let mfaEnabled = 0, mfaDisabled = 0;
    try {
      const mfaData = await graphGet('/reports/authenticationMethods/userRegistrationDetails?$top=999', true);
      (mfaData.value || []).forEach(u => { if (u.isMfaRegistered) mfaEnabled++; else mfaDisabled++; });
    } catch {}
    res.json({
      total_users:    users.length,
      active_users:   users.filter(u => u.accountEnabled).length,
      licensed_users: users.filter(u => u.assignedLicenses?.length > 0).length,
      mfa_enabled:    mfaEnabled,
      mfa_disabled:   mfaDisabled,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const [usersRes, rolesRes] = await Promise.allSettled([
      graphGet('/users?$select=id,displayName,mail,accountEnabled,assignedLicenses,jobTitle,department,userType&$top=999'),
      graphGet('/directoryRoles?$expand=members'),
    ]);

    const users = usersRes.status === 'fulfilled' ? (usersRes.value.value || []) : [];

    // Admin roles map
    const adminMap = {};
    if (rolesRes.status === 'fulfilled') {
      for (const role of (rolesRes.value.value || [])) {
        for (const member of (role.members || [])) {
          if (!adminMap[member.id]) adminMap[member.id] = [];
          adminMap[member.id].push(role.displayName);
        }
      }
    }

    // MFA map
    const mfaMap = {};
    try {
      const mfaData = await graphGet('/reports/authenticationMethods/userRegistrationDetails?$top=999', true);
      (mfaData.value || []).forEach(u => {
        mfaMap[u.id] = { registered: u.isMfaRegistered || false, methods: u.methodsRegistered || [] };
      });
    } catch {}

    const enriched = users.map(u => ({
      id:         u.id,
      name:       u.displayName,
      email:      u.mail,
      enabled:    u.accountEnabled,
      title:      u.jobTitle,
      department: u.department,
      licensed:   (u.assignedLicenses?.length || 0) > 0,
      assigned_licence_ids: (u.assignedLicenses || []).map(l => l.skuId),
      user_type:  u.userType || 'Member',
      is_admin:   !!adminMap[u.id],
      admin_roles: adminMap[u.id] || [],
      mfa: mfaMap[u.id] || { registered: null, methods: [] },
    }));

    res.json({
      users: enriched,
      groups: {
        admins:          enriched.filter(u => u.is_admin && u.enabled),
        mfa:             enriched.filter(u => !u.is_admin && u.enabled && u.mfa.registered === true),
        no_mfa:          enriched.filter(u => !u.is_admin && u.enabled && u.mfa.registered !== true),
        disabled:        enriched.filter(u => !u.enabled),
        shared_mailboxes:enriched.filter(u => !u.licensed && u.enabled && !u.is_admin),
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── User groups ───────────────────────────────────────────────────────────────
router.get('/users/:id/groups', async (req, res) => {
  try {
    const data = await graphGet(`/users/${req.params.id}/memberOf?$select=displayName,description`);
    res.json(data.value || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SKUs / Licences ───────────────────────────────────────────────────────────
router.get('/skus', async (req, res) => {
  try {
    const data = await graphGet('/subscribedSkus');
    res.json((data.value || []).map(s => ({
      skuId:        s.skuId,
      skuPartNumber:s.skuPartNumber,
      displayName:  getSkuName(s.skuPartNumber),
      total:        (s.prepaidUnits?.enabled || 0) + (s.prepaidUnits?.warning || 0),
      used:         s.consumedUnits || 0,
      available:    ((s.prepaidUnits?.enabled || 0) + (s.prepaidUnits?.warning || 0)) - (s.consumedUnits || 0),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Service health ────────────────────────────────────────────────────────────
router.get('/service-health', async (req, res) => {
  try {
    const data = await graphGet('/admin/serviceAnnouncement/healthOverviews?$expand=issues');
    res.json((data.value || []).map(s => ({
      service:       s.service,
      status:        s.status,
      active_issues: (s.issues || []).filter(i => i.status !== 'resolved').length,
      issues:        (s.issues || []).filter(i => i.status !== 'resolved').slice(0, 5),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Storage reports ───────────────────────────────────────────────────────────
const csv = require('csv-parse/sync');

function parseReportCsv(raw) {
  try {
    // Strip BOM if present
    const clean = raw.replace(/^\uFEFF/, '').trim();
    return csv.parse(clean, { columns: true, skip_empty_lines: true, trim: true });
  } catch { return []; }
}

async function getReportCsv(path) {
  const token = await getM365Token();
  const axios = require('axios');
  const res = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/plain' },
    responseType: 'text',
    timeout: 30000,
  });
  return res.data;
}

function fmtBytes(bytes) {
  const b = parseInt(bytes) || 0;
  if (b >= 1073741824) return { value: Math.round((b / 1073741824) * 10) / 10, unit: 'GB', bytes: b };
  if (b >= 1048576)    return { value: Math.round((b / 1048576)    * 10) / 10, unit: 'MB', bytes: b };
  return { value: b, unit: 'B', bytes: b };
}

// GET /api/m365/storage/onedrive?period=D30
router.get('/storage/onedrive', async (req, res) => {
  const period = ['D7','D30','D90','D180'].includes(req.query.period) ? req.query.period : 'D30';
  try {
    const raw  = await getReportCsv(`/reports/getOneDriveUsageAccountDetail(period='${period}')`);
    const rows = parseReportCsv(raw);

    const result = rows
      .filter(r => r['Is Deleted'] !== 'True' && r['Is Deleted'] !== true)
      .map(r => {
        const usedKey   = Object.keys(r).find(k => k.toLowerCase().includes('storage used')) || '';
        const quotaKey  = Object.keys(r).find(k => k.toLowerCase().includes('storage allocated')) || '';
        const emailKey  = Object.keys(r).find(k => k.toLowerCase().includes('owner principal name') || k.toLowerCase().includes('user principal')) || '';
        const nameKey   = Object.keys(r).find(k => k.toLowerCase().includes('owner display name') || k.toLowerCase().includes('display name')) || '';
        const usedBytes = parseInt(r[usedKey]) || 0;
        const quotaBytes= parseInt(r[quotaKey]) || 0;
        return {
          email:      r[emailKey] || '—',
          name:       r[nameKey]  || '—',
          used:       fmtBytes(usedBytes),
          quota:      fmtBytes(quotaBytes),
          pct:        quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0,
          used_bytes: usedBytes,
        };
      })
      .filter(r => r.used_bytes > 0)
      .sort((a, b) => b.used_bytes - a.used_bytes);

    res.json({ period, count: result.length, items: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/m365/storage/mailbox?period=D30
router.get('/storage/mailbox', async (req, res) => {
  const period = ['D7','D30','D90','D180'].includes(req.query.period) ? req.query.period : 'D30';
  try {
    const raw  = await getReportCsv(`/reports/getMailboxUsageDetail(period='${period}')`);
    const rows = parseReportCsv(raw);

    const result = rows
      .filter(r => r['Is Deleted'] !== 'True' && r['Is Deleted'] !== true)
      .map(r => {
        const usedKey  = Object.keys(r).find(k => k.toLowerCase().includes('storage used')) || '';
        const quotaKey = Object.keys(r).find(k => k.toLowerCase().includes('prohibit send quota') || k.toLowerCase().includes('mailbox storage quota')) || '';
        const emailKey = Object.keys(r).find(k => k.toLowerCase().includes('user principal name')) || '';
        const nameKey  = Object.keys(r).find(k => k.toLowerCase().includes('display name')) || '';
        const usedBytes  = parseInt(r[usedKey]) || 0;
        const quotaBytes = parseInt(r[quotaKey]) || 0;
        return {
          email:      r[emailKey] || '—',
          name:       r[nameKey]  || '—',
          used:       fmtBytes(usedBytes),
          quota:      fmtBytes(quotaBytes),
          pct:        quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0,
          used_bytes: usedBytes,
        };
      })
      .filter(r => r.used_bytes > 0)
      .sort((a, b) => b.used_bytes - a.used_bytes);

    res.json({ period, count: result.length, items: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
