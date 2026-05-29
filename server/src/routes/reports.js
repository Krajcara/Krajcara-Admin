'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// ── Helper: gather all report data ────────────────────────────────────────────
async function gatherReportData(period = 30) {
  const since = new Date(Date.now() - period * 86400000)
    .toISOString().replace('T', ' ').substring(0, 19);

  // Monitors
  const monitors      = db.prepare('SELECT * FROM monitors WHERE enabled=1').all();
  const monitorsUp    = monitors.filter(m => m.last_status === 'up').length;
  const monitorsDown  = monitors.filter(m => m.last_status === 'down').length;
  const monitorsDeg   = monitors.filter(m => m.last_status === 'degraded').length;
  const avgLatency    = monitors.filter(m => m.last_latency_ms).length
    ? Math.round(monitors.filter(m => m.last_latency_ms).reduce((a, m) => a + m.last_latency_ms, 0) / monitors.filter(m => m.last_latency_ms).length)
    : null;
  const topLatency = [...monitors]
    .filter(m => m.last_latency_ms != null)
    .sort((a, b) => b.last_latency_ms - a.last_latency_ms)
    .slice(0, 5)
    .map(m => ({ label: m.label, latency_ms: m.last_latency_ms, status: m.last_status }));

  // Speed tests
  const speedTests = db.prepare(
    "SELECT download, upload, ping, created_at FROM speed_tests WHERE status='done' AND created_at >= ? ORDER BY created_at DESC LIMIT 30"
  ).all(since);
  const avgDownload = speedTests.length ? Math.round(speedTests.reduce((a, t) => a + (t.download || 0), 0) / speedTests.length * 10) / 10 : null;
  const avgUpload   = speedTests.length ? Math.round(speedTests.reduce((a, t) => a + (t.upload   || 0), 0) / speedTests.length * 10) / 10 : null;
  const avgPing     = speedTests.length ? Math.round(speedTests.reduce((a, t) => a + (t.ping     || 0), 0) / speedTests.length) : null;
  const lastSpeed   = speedTests[0] || null;

  // Licences
  const licences       = db.prepare("SELECT * FROM licences WHERE hidden=0").all();
  const now            = new Date();
  const expiring30     = licences.filter(l => l.expiry_date && Math.ceil((new Date(l.expiry_date) - now) / 86400000) <= 30 && Math.ceil((new Date(l.expiry_date) - now) / 86400000) > 0);
  const expired        = licences.filter(l => l.expiry_date && new Date(l.expiry_date) < now);
  const expiring60     = licences.filter(l => {
    if (!l.expiry_date) return false;
    const d = Math.ceil((new Date(l.expiry_date) - now) / 86400000);
    return d > 0 && d <= 60;
  });
  const freeLicences   = licences.filter(l => !parseFloat(l.price_per_licence) || l.is_free);
  const paidLicences   = licences.filter(l => parseFloat(l.price_per_licence) > 0 && !l.is_free);
  // Group costs by currency — net (no tax) and gross (with tax)
  const costByCurrency = {};
  for (const l of paidLicences) {
    const p      = parseFloat(l.price_per_licence) || 0;
    const cnt    = parseInt(l.licence_count) || 1;
    const cur    = (l.currency || 'EUR').toUpperCase();
    const tax    = parseFloat(l.tax_percent) || 0;
    const netM   = l.billing_cycle === 'monthly' ? p * cnt : (p * cnt) / 12;
    const netA   = l.billing_cycle === 'monthly' ? p * cnt * 12 : p * cnt;
    const grossM = netM * (1 + tax / 100);
    const grossA = netA * (1 + tax / 100);
    if (!costByCurrency[cur]) costByCurrency[cur] = { net_monthly: 0, net_annual: 0, gross_monthly: 0, gross_annual: 0, savings_monthly: 0, savings_annual: 0 };
    costByCurrency[cur].net_monthly   += netM;
    costByCurrency[cur].net_annual    += netA;
    costByCurrency[cur].gross_monthly += grossM;
    costByCurrency[cur].gross_annual  += grossA;
  }
  // Add savings from free licences (value of equivalent paid licences — just count them)
  // Round all values
  for (const cur of Object.keys(costByCurrency)) {
    for (const k of Object.keys(costByCurrency[cur])) {
      costByCurrency[cur][k] = Math.round(costByCurrency[cur][k] * 100) / 100;
    }
  }
  const totalCostAnnual  = Object.values(costByCurrency).reduce((a, v) => a + v.net_annual,  0);
  const totalCostMonthly = Object.values(costByCurrency).reduce((a, v) => a + v.net_monthly, 0);

  // Entra apps
  const entraApps    = db.prepare("SELECT * FROM entra_apps WHERE hidden=0").all();
  const entraExpiring = entraApps.filter(a => {
    if (!a.secret_expiry) return false;
    const d = Math.ceil((new Date(a.secret_expiry) - now) / 86400000);
    return d <= 30 && d > 0;
  });

  // Notifications in period
  const notifications = db.prepare(
    "SELECT * FROM notifications WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20"
  ).all(since);
  const notifByType = {
    error:   notifications.filter(n => n.type === 'error').length,
    warning: notifications.filter(n => n.type === 'warning').length,
    success: notifications.filter(n => n.type === 'success').length,
    info:    notifications.filter(n => n.type === 'info').length,
  };
  const notifByModule = {};
  for (const n of notifications) {
    notifByModule[n.module] = (notifByModule[n.module] || 0) + 1;
  }

  // Routers & DNS
  const routers    = db.prepare('SELECT * FROM routers').all();
  const dnsServers = db.prepare('SELECT * FROM dns_local').all();

  // Proxmox
  let proxmox = null;
  try {
    const axios      = require('axios');
    const https      = require('https');
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const url        = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value;
    const tokenId    = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
    const user       = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
    const secret     = db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value;
    if (url && secret) {
      const token   = tokenId ? `${user}!${tokenId}=${secret}` : secret;
      const headers = { Authorization: `PVEAPIToken=${token}` };
      const opts    = { headers, httpsAgent, timeout: 10000 };
      const nodesRes = await axios.get(`${url}/api2/json/nodes`, opts);
      const details  = await Promise.all((nodesRes.data.data || []).filter(n => n.status === 'online').map(async n => {
        const [vmsRes, lxcRes] = await Promise.all([
          axios.get(`${url}/api2/json/nodes/${n.node}/qemu`, opts).catch(() => ({ data: { data: [] } })),
          axios.get(`${url}/api2/json/nodes/${n.node}/lxc`,  opts).catch(() => ({ data: { data: [] } })),
        ]);
        const vms = vmsRes.data.data || [];
        const lxc = lxcRes.data.data || [];
        return {
          node: n.node, status: n.status,
          cpu_usage:   n.cpu != null ? Math.round(n.cpu * 100) : 0,
          mem_usage:   n.mem && n.maxmem ? Math.round((n.mem / n.maxmem) * 100) : 0,
          maxcpu:      n.maxcpu || 0,
          maxmem_gb:   n.maxmem ? (n.maxmem / 1073741824).toFixed(1) : '0',
          mem_used_gb: n.mem    ? (n.mem    / 1073741824).toFixed(1) : '0',
          uptime:      n.uptime,
          vm_count:    vms.length, lxc_count: lxc.length,
          vm_running:  vms.filter(v => v.status === 'running').length,
          lxc_running: lxc.filter(v => v.status === 'running').length,
        };
      }));
      proxmox = { configured: true, nodes: details.sort((a, b) => a.node.localeCompare(b.node)) };
    }
  } catch {}

  // M365 mail flow
  let mailFlow = null;
  try {
    const axios = require('axios');
    const tid   = db.prepare("SELECT value FROM settings WHERE key='m365_tenant_id'").get()?.value;
    const cid   = db.prepare("SELECT value FROM settings WHERE key='m365_client_id'").get()?.value;
    const sec   = db.prepare("SELECT value FROM settings WHERE key='m365_client_secret'").get()?.value;
    if (tid && cid && sec) {
      const tokenRes = await axios.post(
        `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
        new URLSearchParams({ grant_type: 'client_credentials', client_id: cid, client_secret: sec, scope: 'https://graph.microsoft.com/.default' }),
        { timeout: 15000 }
      );
      const token   = tokenRes.data.access_token;
      const mPeriod = period <= 7 ? 'D7' : period <= 30 ? 'D30' : period <= 90 ? 'D90' : 'D180';
      const r = await axios.get(
        `https://graph.microsoft.com/v1.0/reports/getEmailActivityUserDetail(period='${mPeriod}')`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 25000, maxRedirects: 5 }
      );
      const raw = typeof r.data === 'string' ? r.data : '';
      if (raw) {
        const lines = raw.replace(/\uFEFF/, '').trim().split('\n').filter(Boolean);
        const hdrs  = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows  = lines.slice(1).map(line => {
          const vals = []; let cur = '', inQ = false;
          for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
            else cur += ch;
          }
          vals.push(cur.trim());
          const obj = {};
          hdrs.forEach((h, i) => obj[h] = (vals[i] || '').replace(/^"|"$/g, ''));
          return obj;
        });
        const domainMap = {};
        for (const row of rows) {
          const email  = row['User Principal Name'] || '';
          if (!email || email.includes('#EXT#')) continue;
          const domain = email.split('@')[1]?.toLowerCase();
          if (!domain) continue;
          if (!domainMap[domain]) domainMap[domain] = { domain, send: 0, receive: 0, read: 0 };
          domainMap[domain].send    += parseInt(row['Send Count']    || 0) || 0;
          domainMap[domain].receive += parseInt(row['Receive Count'] || 0) || 0;
          domainMap[domain].read    += parseInt(row['Read Count']    || 0) || 0;
        }
        const domains = Object.values(domainMap).sort((a, b) => (b.send + b.receive) - (a.send + a.receive));
        const totals  = domains.reduce((a, d) => ({ send: a.send + d.send, receive: a.receive + d.receive, read: a.read + d.read }), { send: 0, receive: 0, read: 0 });
        mailFlow = { domains, totals };
      }
    }
  } catch {}

  // DNS External domains — from Cloudflare zones
  let dnsExternal = [];
  try {
    const dnsLib  = require('dns').promises;
    const cfToken = db.prepare("SELECT value FROM settings WHERE key='cloudflare_api_token'").get()?.value;
    const cfZoneId = db.prepare("SELECT value FROM settings WHERE key='cloudflare_zone_id'").get()?.value;
    if (cfToken) {
      const axios2 = require('axios');
      const hdrs   = { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' };
      let zones    = [];
      if (cfZoneId) {
        try {
          const r = await axios2.get(`https://api.cloudflare.com/client/v4/zones/${cfZoneId}`, { headers: hdrs, timeout: 10000 });
          if (r.data.success) zones = [r.data.result];
        } catch {}
      }
      if (!zones.length) {
        const r = await axios2.get('https://api.cloudflare.com/client/v4/zones?per_page=50&status=active', { headers: hdrs, timeout: 10000 });
        if (r.data.success) zones = r.data.result || [];
      }
      dnsExternal = await Promise.all(zones.map(async z => {
        const domain = z.name;
        let spf = false, dkim = false, dmarc = false, mx = false;
        try { const txts = await dnsLib.resolveTxt(domain); spf  = txts.flat().some(t => t.startsWith('v=spf1')); } catch {}
        try { const mxR  = await dnsLib.resolveMx(domain);  mx   = mxR.length > 0; } catch {}
        try { const dr   = await dnsLib.resolveTxt(`_dmarc.${domain}`); dmarc = dr.flat().some(t => t.startsWith('v=DMARC1')); } catch {}
        for (const sel of ['default','selector1','selector2','google','k1','dkim','mail']) {
          try { const val = (await dnsLib.resolveTxt(`${sel}._domainkey.${domain}`)).flat().join(''); if (val.includes('v=DKIM1')) { dkim = true; break; } } catch {}
        }
        return { domain, spf, dkim, dmarc, mx, score: [spf,dkim,dmarc,mx].filter(Boolean).length };
      }));
    }
  } catch {}

  // M365 mail flow monthly trend (last 6 months)
  let mailFlowMonthly = null;
  try {
    if (mailFlow) {
      const axios2 = require('axios');
      const tid2   = db.prepare("SELECT value FROM settings WHERE key='m365_tenant_id'").get()?.value;
      const cid2   = db.prepare("SELECT value FROM settings WHERE key='m365_client_id'").get()?.value;
      const sec2   = db.prepare("SELECT value FROM settings WHERE key='m365_client_secret'").get()?.value;
      if (tid2 && cid2 && sec2) {
        const tr2 = await axios2.post(
          `https://login.microsoftonline.com/${tid2}/oauth2/v2.0/token`,
          new URLSearchParams({ grant_type: 'client_credentials', client_id: cid2, client_secret: sec2, scope: 'https://graph.microsoft.com/.default' }),
          { timeout: 15000 }
        );
        const tok2 = tr2.data.access_token;
        const r2   = await axios2.get(
          `https://graph.microsoft.com/v1.0/reports/getEmailActivityCounts(period='D180')`,
          { headers: { Authorization: `Bearer ${tok2}` }, timeout: 20000, maxRedirects: 5 }
        );
        const raw2 = typeof r2.data === 'string' ? r2.data : '';
        if (raw2) {
          const lines2 = raw2.replace(/^\uFEFF/, '').trim().split('\n').filter(Boolean);
          const hdrs2  = lines2[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          const rows2  = lines2.slice(1).map(line => {
            const vals = []; let cur2 = '', inQ = false;
            for (const ch of line) { if (ch==='"') inQ=!inQ; else if (ch===','&&!inQ){vals.push(cur2.trim());cur2='';}else cur2+=ch; }
            vals.push(cur2.trim());
            const obj = {}; hdrs2.forEach((h,i)=>obj[h]=(vals[i]||'').replace(/^"|"$/g,''));
            return obj;
          });
          const now2 = new Date();
          const monthMap = {};
          for (let i=5;i>=0;i--) {
            const d2=new Date(now2.getFullYear(),now2.getMonth()-i,1);
            const key=`${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}`;
            monthMap[key]={ label: d2.toLocaleString('en',{month:'short',year:'numeric'}), send:0, receive:0, read:0 };
          }
          for (const row of rows2) {
            const dateStr = row['Report Date'] || row['Report Refresh Date'] || '';
            if (!dateStr) continue;
            const d3=new Date(dateStr);
            if (isNaN(d3)) continue;
            const key=`${d3.getFullYear()}-${String(d3.getMonth()+1).padStart(2,'0')}`;
            if (monthMap[key]) { monthMap[key].send+=parseInt(row['Send']||0)||0; monthMap[key].receive+=parseInt(row['Receive']||0)||0; monthMap[key].read+=parseInt(row['Read']||0)||0; }
          }
          const months = Object.values(monthMap);
          const last2  = months[months.length-1];
          const prev2  = months[months.length-2];
          mailFlowMonthly = { months, trend: last2&&prev2 ? last2.send-prev2.send : null };
        }
      }
    }
  } catch {}

  return {
    period,
    generated_at: new Date().toISOString(),
    monitors:     { total: monitors.length, up: monitorsUp, down: monitorsDown, degraded: monitorsDeg, avg_latency_ms: avgLatency, top_latency: topLatency, all: monitors },
    speed:        { tests: speedTests.length, avg_download: avgDownload, avg_upload: avgUpload, avg_ping: avgPing, last: lastSpeed, history: speedTests.slice(0, 30).reverse() },
    licences:     { total: licences.length, paid: paidLicences.length, free: freeLicences.length, expiring_30: expiring30.length, expiring_60: expiring60, expired: expired.length, annual_cost: totalCostAnnual, monthly_cost: totalCostMonthly, cost_by_currency: costByCurrency, list: licences, free_list: freeLicences },
    entra:        { total: entraApps.length, expiring_30: entraExpiring.length, list: entraApps },
    notifications:{ total: notifications.length, by_type: notifByType, by_module: notifByModule, recent: notifications.slice(0, 10) },
    network:      { routers: routers.length, dns: dnsServers.length },
    dnsExternal,
    mailFlowMonthly,
    proxmox,
    mailFlow,
  };
}

// GET /api/reports/data?period=30
router.get('/data', async (req, res) => {
  try {
    const period = Math.min(parseInt(req.query.period) || 30, 365);
    const data   = await gatherReportData(period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/generate?period=30 — PDF download
router.get('/generate', requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const period = Math.min(parseInt(req.query.period) || 30, 365);
    const d      = await gatherReportData(period);
    const PDFDocument = require('pdfkit');
    const doc    = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const appName = db.prepare("SELECT value FROM settings WHERE key='app_name'").get()?.value || 'Krajcara Admin';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().split('T')[0]}.pdf"`);
    res.on('error', () => { try { doc.end(); } catch {} });
    doc.on('error', (err) => { console.error('[Reports] PDF doc error:', err.message); });
    doc.pipe(res);

    const W = doc.page.width, H = doc.page.height, M = 50, PW = W - M * 2;
    const C = {
      primary: '#1E40AF', accent: '#3B82F6', green: '#16A34A',
      red: '#DC2626', orange: '#EA580C',
      gray1: '#111827', gray2: '#374151', gray3: '#6B7280',
      gray4: '#9CA3AF', gray5: '#E5E7EB', gray6: '#F3F4F6',
      white: '#FFFFFF', dark: '#0F172A',
    };

    const safe = (v, f = '—') => (v != null && v !== '') ? String(v) : f;
    const fmtN = (n, dec = 2) => (n != null && !isNaN(n)) ? Number(n).toLocaleString('en', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';
    const fmtI = (n) => (n != null && !isNaN(n)) ? Number(n).toLocaleString('en') : '—';

    // ── Helpers ───────────────────────────────────────────────────────────────
    const sectionTitle = (title) => {
      doc.moveDown(0.8);
      const y = doc.y;
      doc.rect(M, y, 3, 16).fill(C.accent);
      doc.fillColor(C.gray1).fontSize(11).font('Helvetica-Bold').text(title, M + 10, y + 1);
      doc.rect(M, y + 18, PW, 0.5).fill(C.gray5);
      doc.y = y + 26;
      doc.font('Helvetica').fontSize(9).fillColor(C.gray2);
    };

    // Stat box: (x, y, w, h, value, label, color)
    const statBox = (x, y, w, h, val, label, color = C.accent) => {
      doc.rect(x, y, w, h).fill(C.gray6);
      doc.rect(x, y, w, 3).fill(color);
      doc.fillColor(color).fontSize(16).font('Helvetica-Bold')
        .text(safe(val), x, y + 12, { width: w, align: 'center' });
      doc.fillColor(C.gray4).fontSize(7).font('Helvetica')
        .text(label.toUpperCase(), x, y + 32, { width: w, align: 'center' });
    };

    const kv = (label, value, color = null, bold = false) => {
      const y = doc.y;
      doc.fillColor(C.gray4).fontSize(8.5).font('Helvetica').text(label, M, y, { width: 190 });
      doc.fillColor(color || C.gray1).fontSize(8.5).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(safe(value), M + 200, y, { width: PW - 200 });
      doc.font('Helvetica').fillColor(C.gray1);
      doc.y = y + 13;
    };

    const tHead = (cols) => {
      const y = doc.y;
      doc.rect(M, y, PW, 16).fill(C.primary);
      let x = M;
      cols.forEach(col => {
        doc.fillColor(C.white).fontSize(7).font('Helvetica-Bold')
          .text(col.label.toUpperCase(), x + 4, y + 4, { width: col.w - 6, ellipsis: true });
        x += col.w;
      });
      doc.y = y + 16;
    };

    const tRow = (cols, vals, alt = false, clrs = {}) => {
      const rh = 14;
      const y  = doc.y;
      if (alt) doc.rect(M, y, PW, rh).fill('#EEF2FF');
      doc.rect(M, y + rh - 0.5, PW, 0.5).fill(C.gray5);
      let x = M;
      cols.forEach((col, i) => {
        doc.fillColor(clrs[i] || C.gray2).fontSize(7.5)
          .font(clrs[i] ? 'Helvetica-Bold' : 'Helvetica')
          .text(safe(vals[i]), x + 4, y + 3, { width: col.w - 8, ellipsis: true });
        x += col.w;
      });
      doc.fillColor(C.gray1).font('Helvetica');
      doc.y = y + rh;
    };

    // ════════════════════════════════════════════════════════════════════════
    // COVER PAGE
    // ════════════════════════════════════════════════════════════════════════
    doc.rect(0, 0, W, H).fill(C.dark);
    doc.rect(0, 0, W, 6).fill(C.primary);
    // Decorative circles
    doc.save().fillColor('#1E3A5F').opacity(0.35).circle(W + 40, 60, 190).fill().restore();
    doc.save().fillColor('#1E3A5F').opacity(0.25).circle(-40, H - 80, 160).fill().restore();

    // Logo box
    doc.rect(M, 100, 52, 52).fill(C.primary);
    doc.fillColor(C.white).fontSize(26).font('Helvetica-Bold').text('K', M, 114, { width: 52, align: 'center' });

    // Title
    doc.fillColor(C.white).fontSize(28).font('Helvetica-Bold').text(appName, M + 62, 108);
    doc.fillColor(C.accent).fontSize(13).font('Helvetica').text('Infrastructure Report', M + 62, 142);

    // Divider
    doc.rect(M, 175, PW, 1).fill('#1D4ED8');

    // Meta info
    doc.rect(M, 192, 110, 24).fill('#1D4ED8');
    doc.fillColor(C.white).fontSize(9).font('Helvetica-Bold').text(`Last ${period} days`, M + 6, 200);
    doc.fillColor(C.gray4).fontSize(8.5).font('Helvetica')
      .text(`Generated: ${new Date().toLocaleString('en')}`, M, 226)
      .text(`Period: ${new Date(Date.now() - period*86400000).toLocaleDateString('en')} — ${new Date().toLocaleDateString('en')}`, M, 240);

    // Summary stat boxes on cover
    const coverStats = [
      { val: `${d.monitors.up}/${d.monitors.total}`, label: 'Monitors Up',  color: C.green  },
      { val: d.monitors.down > 0 ? d.monitors.down : 'None', label: 'Monitors Down', color: d.monitors.down > 0 ? C.red : C.gray4 },
      { val: d.licences.total, label: 'Licences',    color: C.accent },
      { val: d.entra.total,    label: 'Entra Apps',  color: C.accent },
    ];
    const bw = PW / 4;
    coverStats.forEach((s, i) => {
      const bx = M + i * bw;
      doc.rect(bx + 4, 286, bw - 8, 64).fill('#1E293B');
      doc.rect(bx + 4, 286, bw - 8, 3).fill(s.color);
      doc.fillColor(s.color).fontSize(20).font('Helvetica-Bold')
        .text(safe(s.val), bx + 4, 298, { width: bw - 8, align: 'center' });
      doc.fillColor(C.gray4).fontSize(7.5).font('Helvetica')
        .text(s.label.toUpperCase(), bx + 4, 322, { width: bw - 8, align: 'center' });
    });

    // Speed summary on cover
    if (d.speed.tests > 0) {
      const sp2 = [
        { val: d.speed.avg_download != null ? `${d.speed.avg_download} Mbps` : '—', label: 'Avg Download', color: C.accent },
        { val: d.speed.avg_upload   != null ? `${d.speed.avg_upload} Mbps`   : '—', label: 'Avg Upload',   color: C.green },
        { val: d.speed.avg_ping     != null ? `${d.speed.avg_ping} ms`        : '—', label: 'Avg Ping',     color: '#7C3AED' },
        { val: d.speed.tests, label: 'Speed Tests', color: C.gray4 },
      ];
      sp2.forEach((s, i) => {
        const bx = M + i * bw;
        doc.rect(bx + 4, 366, bw - 8, 64).fill('#1E293B');
        doc.rect(bx + 4, 366, bw - 8, 3).fill(s.color);
        doc.fillColor(s.color).fontSize(16).font('Helvetica-Bold')
          .text(safe(s.val), bx + 4, 378, { width: bw - 8, align: 'center' });
        doc.fillColor(C.gray4).fontSize(7.5).font('Helvetica')
          .text(s.label.toUpperCase(), bx + 4, 400, { width: bw - 8, align: 'center' });
      });
    }

    // Costs summary on cover
    if (d.licences.cost_by_currency && Object.keys(d.licences.cost_by_currency).length) {
      let cy = 450;
      doc.fillColor(C.gray4).fontSize(8).font('Helvetica-Bold').text('LICENCE COSTS (ANNUAL INCL. TAX)', M, cy); cy += 14;
      Object.entries(d.licences.cost_by_currency).forEach(([cur, costs]) => {
        doc.fillColor(C.accent).fontSize(9).font('Helvetica-Bold').text(cur, M, cy, { width: 50 });
        doc.fillColor(C.white).fontSize(9).font('Helvetica').text(`${fmtN(costs.gross_annual)} ${cur}  /year  ·  ${fmtN(costs.gross_monthly)} ${cur}/mo`, M + 55, cy);
        cy += 14;
      });
    }

    // Cover footer
    doc.rect(0, H - 36, W, 36).fill('#0A0F1E');
    doc.fillColor(C.gray4).fontSize(7.5).font('Helvetica')
      .text('CONFIDENTIAL — IT INFRASTRUCTURE REPORT', M, H - 22, { width: PW, align: 'center' });

    // ════════════════════════════════════════════════════════════════════════
    // REPORT PAGE — everything on one page
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage();
    // Top accent
    doc.rect(0, 0, W, 6).fill(C.primary);
    doc.rect(0, 6, W, 30).fill(C.gray6);
    doc.fillColor(C.gray3).fontSize(7.5).font('Helvetica')
      .text(appName.toUpperCase(), M, 17, { width: PW * 0.6 });
    doc.fillColor(C.gray3).text(`Generated ${new Date().toLocaleString('en')}`, M, 17, { width: PW, align: 'right' });
    doc.y = 50;

    // ── 1. UPTIME MONITORS ────────────────────────────────────────────────
    sectionTitle('Uptime Monitors');
    const msw = (PW - 9) / 4;
    const msy = doc.y;
    statBox(M,            msy, msw-3, 44, d.monitors.up,       'Up',        C.green);
    statBox(M+msw,        msy, msw-3, 44, d.monitors.down,     'Down',      d.monitors.down > 0 ? C.red : C.gray4);
    statBox(M+msw*2,      msy, msw-3, 44, d.monitors.degraded, 'Degraded',  d.monitors.degraded > 0 ? C.orange : C.gray4);
    statBox(M+msw*3,      msy, msw-3, 44, d.monitors.avg_latency_ms != null ? `${d.monitors.avg_latency_ms}ms` : '—', 'Avg Latency', C.accent);
    doc.y = msy + 52;

    // ── 2. INTERNET SPEED ─────────────────────────────────────────────────
    sectionTitle('Internet Speed');
    if (d.speed.tests > 0) {
      const ssw = (PW - 9) / 4;
      const ssy = doc.y;
      statBox(M,       ssy, ssw-3, 44, d.speed.avg_download != null ? `${d.speed.avg_download} Mbps` : '—', 'Avg Download', C.accent);
      statBox(M+ssw,   ssy, ssw-3, 44, d.speed.avg_upload   != null ? `${d.speed.avg_upload} Mbps`   : '—', 'Avg Upload',   C.green);
      statBox(M+ssw*2, ssy, ssw-3, 44, d.speed.avg_ping     != null ? `${d.speed.avg_ping} ms`        : '—', 'Avg Ping',     '#7C3AED');
      statBox(M+ssw*3, ssy, ssw-3, 44, d.speed.tests, 'Tests', C.gray4);
      doc.y = ssy + 52;
    } else {
      doc.fillColor(C.gray4).fontSize(8).text('No speed tests in period', M, doc.y); doc.moveDown(0.5);
    }

    // ── 3. LICENCES & COSTS ───────────────────────────────────────────────
    sectionTitle('Licences & Costs');
    const lsw = (PW - 6) / 3;
    const lsy = doc.y;
    statBox(M,       lsy, lsw-3, 44, d.licences.total, 'Total',  C.accent);
    statBox(M+lsw,   lsy, lsw-3, 44, d.licences.paid,  'Paid',   C.primary);
    statBox(M+lsw*2, lsy, lsw-3, 44, d.licences.free,  'Free',   C.green);
    doc.y = lsy + 52;
    if (d.licences.cost_by_currency && Object.keys(d.licences.cost_by_currency).length) {
      doc.moveDown(0.2);
      const ccols = [
        { label: 'Currency',          w: 70  },
        { label: 'Monthly (net)',      w: 110 },
        { label: 'Annual (net)',       w: 110 },
        { label: 'Annual (incl.tax)', w: 125 },
      ];
      tHead(ccols);
      Object.entries(d.licences.cost_by_currency).forEach(([cur, costs], i) => {
        tRow(ccols, [cur, `${fmtN(costs.net_monthly)} ${cur}`, `${fmtN(costs.net_annual)} ${cur}`, `${fmtN(costs.gross_annual)} ${cur}`], i%2===1, { 3: C.primary });
      });
    }
    if (d.licences.expiring_30 > 0) { doc.moveDown(0.3); kv('Expiring in 30 days', d.licences.expiring_30, C.red, true); }
    if (d.licences.expired > 0)     { kv('Expired', d.licences.expired, C.red, true); }

    // ── 4. EMAIL ACTIVITY ─────────────────────────────────────────────────
    if (d.mailFlowMonthly?.months?.length) {
      sectionTitle('Email Activity — M365');
      const emCols = [
        { label: 'Month',    w: 90  },
        { label: 'Sent',     w: 80  },
        { label: 'Received', w: 90  },
        { label: 'Read',     w: 80  },
        { label: 'Total',    w: 75  },
      ];
      tHead(emCols);
      d.mailFlowMonthly.months.forEach((m, i) => {
        tRow(emCols, [m.label, fmtI(m.send), fmtI(m.receive), fmtI(m.read), fmtI(m.send+m.receive)], i%2===1, { 1: C.accent, 2: C.green, 3: '#7C3AED' });
      });
      if (d.mailFlowMonthly.trend != null) {
        doc.moveDown(0.2);
        const tc = d.mailFlowMonthly.trend < 0 ? C.red : C.green;
        const ts = d.mailFlowMonthly.trend > 0 ? '+' : '';
        kv('Trend vs prev month', `${ts}${fmtI(d.mailFlowMonthly.trend)} sent`, tc, true);
      }
      if (d.mailFlow?.domains?.length) {
        doc.moveDown(0.3);
        doc.fillColor(C.gray3).fontSize(7.5).font('Helvetica-Bold').text('BY DOMAIN', M, doc.y); doc.moveDown(0.2);
        const dmCols = [{ label: 'Domain', w: 155 }, { label: 'Sent', w: 80 }, { label: 'Received', w: 90 }, { label: 'Read', w: 90 }];
        tHead(dmCols);
        d.mailFlow.domains.forEach((dm, i) => {
          tRow(dmCols, [`@${dm.domain}`, fmtI(dm.send), fmtI(dm.receive), fmtI(dm.read)], i%2===1, { 1: C.accent, 2: C.green, 3: '#7C3AED' });
        });
      }
    }

    // ── 5. DNS EXTERNAL ───────────────────────────────────────────────────
    if (d.dnsExternal?.length) {
      sectionTitle('DNS — External Domain Security');
      const dnsCols = [
        { label: 'Domain', w: 160 }, { label: 'SPF', w: 55 }, { label: 'DKIM', w: 55 },
        { label: 'DMARC', w: 55 },  { label: 'MX', w: 55 },  { label: 'Score', w: 55 },
      ];
      tHead(dnsCols);
      d.dnsExternal.forEach((dm, i) => {
        const sc = dm.score===4 ? C.green : dm.score>=2 ? C.orange : C.red;
        const ck = v => v ? '✓' : '✗';
        tRow(dnsCols, [dm.domain, ck(dm.spf), ck(dm.dkim), ck(dm.dmarc), ck(dm.mx), `${dm.score}/4`], i%2===1, {
          1: dm.spf?C.green:C.red, 2: dm.dkim?C.green:C.red, 3: dm.dmarc?C.green:C.red, 4: dm.mx?C.green:C.red, 5: sc,
        });
      });
    }

    // ── 6. PROXMOX ────────────────────────────────────────────────────────
    if (d.proxmox?.configured && d.proxmox.nodes.length) {
      sectionTitle('Proxmox Infrastructure');
      const totalCPU = d.proxmox.nodes.reduce((a,n) => a+n.maxcpu, 0);
      const totalRAM = d.proxmox.nodes.reduce((a,n) => a+parseFloat(n.maxmem_gb||0), 0);
      const rVMs     = d.proxmox.nodes.reduce((a,n) => a+n.vm_running, 0);
      const rLXC     = d.proxmox.nodes.reduce((a,n) => a+n.lxc_running, 0);
      const tVMs     = d.proxmox.nodes.reduce((a,n) => a+n.vm_count, 0);
      const tLXC     = d.proxmox.nodes.reduce((a,n) => a+n.lxc_count, 0);

      const psw = (PW-9)/4;
      const psy = doc.y;
      statBox(M,       psy, psw-3, 44, d.proxmox.nodes.length,    'Nodes',      C.accent);
      statBox(M+psw,   psy, psw-3, 44, totalCPU,                  'Total cores', C.primary);
      statBox(M+psw*2, psy, psw-3, 44, `${totalRAM.toFixed(0)}GB`,'Total RAM',  C.primary);
      statBox(M+psw*3, psy, psw-3, 44, `${rVMs+rLXC}/${tVMs+tLXC}`, 'Running', C.green);
      doc.y = psy + 52;

      doc.moveDown(0.2);
      const pCols = [
        { label: 'Node', w: 80 }, { label: 'Status', w: 65 }, { label: 'CPU cores', w: 75 },
        { label: 'CPU %', w: 55 }, { label: 'RAM (GB)', w: 110 }, { label: 'RAM %', w: 55 },
        { label: 'VMs', w: 50 }, { label: 'LXC', w: 45 },
      ];
      tHead(pCols);
      d.proxmox.nodes.forEach((n, i) => {
        tRow(pCols, [n.node, n.status, n.maxcpu, `${n.cpu_usage}%`, `${n.mem_used_gb}/${n.maxmem_gb}`, `${n.mem_usage}%`, `${n.vm_running}/${n.vm_count}`, `${n.lxc_running}/${n.lxc_count}`], i%2===1, {
          1: n.status==='online'?C.green:C.red,
          3: n.cpu_usage>80?C.red:n.cpu_usage>60?C.orange:C.gray2,
          5: n.mem_usage>80?C.red:n.mem_usage>60?C.orange:C.gray2,
        });
      });
    }

    // ── 7. ENTRA ID ───────────────────────────────────────────────────────
    if (d.entra?.total > 0) {
      sectionTitle('Entra ID App Registrations');
      const esw = (PW-6)/3;
      const esy = doc.y;
      statBox(M,       esy, esw-3, 44, d.entra.total,                        'Total Apps',          C.accent);
      statBox(M+esw,   esy, esw-3, 44, d.entra.expiring_30,                  'Expiring this month', d.entra.expiring_30>0?C.red:C.gray4);
      statBox(M+esw*2, esy, esw-3, 44, d.entra.total-d.entra.expiring_30,   'OK',                  C.green);
      doc.y = esy + 52;
    }

    // ════════════════════════════════════════════════════════════════════════
    // FOOTER ON ALL PAGES
    // ════════════════════════════════════════════════════════════════════════
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, H-26, W, 26).fill(C.dark);
      doc.fillColor(C.gray4).fontSize(7.5).font('Helvetica')
        .text(`${appName}  ·  Infrastructure Report  ·  ${new Date().toLocaleDateString('en')}`, M, H-16, { width: PW*0.7 });
      doc.fillColor(C.gray4).fontSize(7.5)
        .text(`Page ${i+1} of ${range.count}`, M, H-16, { width: PW, align: 'right' });
    }

    doc.flushPages();
    doc.end();

  } catch (err) {
    console.error('[Reports] PDF error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      try { doc.end(); } catch {}
    }
  }
});

module.exports = router;
