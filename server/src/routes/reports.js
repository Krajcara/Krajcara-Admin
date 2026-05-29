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

    // ── Design tokens ────────────────────────────────────────────────────────
    const W      = doc.page.width;
    const H      = doc.page.height;
    const MARGIN = 50;
    const PW     = W - MARGIN * 2;

    const C = {
      primary:   '#1E40AF',
      primary2:  '#1D4ED8',
      accent:    '#3B82F6',
      green:     '#16A34A',
      red:       '#DC2626',
      orange:    '#EA580C',
      gray1:     '#111827',
      gray2:     '#374151',
      gray3:     '#6B7280',
      gray4:     '#9CA3AF',
      gray5:     '#E5E7EB',
      gray6:     '#F9FAFB',
      white:     '#FFFFFF',
      rowAlt:    '#F3F6FF',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const safe = (v, fallback = '—') => (v != null && v !== '' && v !== undefined) ? String(v) : fallback;
    const fmtN  = (n, d = 2) => (n != null && !isNaN(n)) ? Number(n).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
    const fmtI  = (n) => (n != null && !isNaN(n)) ? Number(n).toLocaleString('en') : '—';

    let pageNum = 0;

    const addPage = (first = false) => {
      if (!first) doc.addPage();
      pageNum++;
      // Top accent bar
      doc.rect(0, 0, W, 6).fill(C.primary);
      // Header bar
      doc.rect(0, 6, W, 34).fill(C.gray6);
      doc.fillColor(C.gray3).fontSize(7.5).font('Helvetica')
        .text(appName.toUpperCase(), MARGIN, 17, { width: PW * 0.6 })
      doc.fillColor(C.gray3).fontSize(7.5)
        .text(`Page ${pageNum}  ·  Generated ${new Date().toLocaleString('en')}`, MARGIN, 17, { width: PW, align: 'right' });
      doc.y = 55;
    };

    const sectionTitle = (title, icon = '') => {
      doc.moveDown(0.6);
      const y = doc.y;
      // Left accent line
      doc.rect(MARGIN, y, 3, 20).fill(C.accent);
      doc.fillColor(C.gray1).fontSize(12).font('Helvetica-Bold')
        .text((icon ? icon + '  ' : '') + title, MARGIN + 10, y + 3);
      doc.fillColor(C.gray5).rect(MARGIN + 10, y + 20, PW - 10, 0.5).fill();
      doc.y = y + 28;
      doc.fillColor(C.gray1).font('Helvetica').fontSize(9);
    };

    const kv = (label, value, color = null) => {
      if (doc.y > H - 80) addPage();
      const y = doc.y;
      doc.fillColor(C.gray4).fontSize(8.5).font('Helvetica').text(label, MARGIN, y, { width: 200 });
      doc.fillColor(color || C.gray1).fontSize(8.5).font('Helvetica-Bold').text(safe(value), MARGIN + 210, y, { width: PW - 210 });
      doc.font('Helvetica').fillColor(C.gray1);
      doc.y = y + 14;
    };

    const statBox = (x, y, w, h, val, label, color = C.accent) => {
      doc.rect(x, y, w, h).fill(C.gray6);
      doc.rect(x, y, 3, h).fill(color);
      doc.fillColor(color).fontSize(18).font('Helvetica-Bold')
        .text(safe(val), x + 10, y + 8, { width: w - 20, align: 'center' });
      doc.fillColor(C.gray4).fontSize(7).font('Helvetica')
        .text(label.toUpperCase(), x + 10, y + 30, { width: w - 20, align: 'center' });
    };

    const tHead = (cols) => {
      if (doc.y > H - 100) addPage();
      const y = doc.y;
      doc.rect(MARGIN, y, PW, 18).fill(C.primary);
      let x = MARGIN;
      cols.forEach(col => {
        doc.fillColor(C.white).fontSize(7.5).font('Helvetica-Bold')
          .text(col.label.toUpperCase(), x + 5, y + 5, { width: col.w - 8, ellipsis: true });
        x += col.w;
      });
      doc.y = y + 18;
    };

    const tRow = (cols, vals, alt = false, colors = {}) => {
      const rowH = 15;
      if (doc.y > H - 60) { addPage(); tHead(cols); }
      const y = doc.y;
      if (alt) doc.rect(MARGIN, y, PW, rowH).fill(C.rowAlt);
      // Row bottom border
      doc.rect(MARGIN, y + rowH - 0.5, PW, 0.5).fill(C.gray5);
      let x = MARGIN;
      cols.forEach((col, i) => {
        const val   = safe(vals[i]);
        const color = colors[i] || C.gray2;
        doc.fillColor(color).fontSize(8).font(colors[i] ? 'Helvetica-Bold' : 'Helvetica')
          .text(val, x + 5, y + 3, { width: col.w - 10, ellipsis: true });
        x += col.w;
      });
      doc.fillColor(C.gray1).font('Helvetica');
      doc.y = y + rowH;
    };

    const checkMark = (val) => val ? '✓' : '✗';
    const statusColor = (s) => ({ up: C.green, down: C.red, degraded: C.orange }[s] || C.gray3);

    // ════════════════════════════════════════════════════════════════════════
    // COVER PAGE
    // ════════════════════════════════════════════════════════════════════════
    doc.rect(0, 0, W, H).fill('#0F172A');

    // Top decorative gradient bar
    doc.rect(0, 0, W, 8).fill(C.primary);

    // Geometric accent shapes
    doc.circle(W + 60, 80, 200).fill('#1E3A5F').opacity(0.4);
    doc.circle(-60, H - 100, 180).fill('#1E3A5F').opacity(0.3);
    doc.opacity(1);

    // Logo area
    doc.rect(MARGIN, 120, 60, 60).fill(C.primary);
    doc.fillColor(C.white).fontSize(28).font('Helvetica-Bold').text('K', MARGIN + 18, 137);

    // Title
    doc.fillColor(C.white).fontSize(32).font('Helvetica-Bold')
      .text(appName, MARGIN + 75, 130);
    doc.fillColor(C.accent).fontSize(14).font('Helvetica')
      .text('Infrastructure Report', MARGIN + 75, 168);

    // Divider line
    doc.rect(MARGIN, 210, PW, 1).fill(C.primary2);

    // Period badge
    doc.rect(MARGIN, 230, 120, 28).fill(C.primary2);
    doc.fillColor(C.white).fontSize(10).font('Helvetica-Bold')
      .text(`Last ${period} days`, MARGIN + 8, 239);

    doc.fillColor(C.gray4).fontSize(9).font('Helvetica')
      .text(`Generated: ${new Date().toLocaleString('en')}`, MARGIN, 270);
    doc.text(`Period: ${new Date(Date.now() - period * 86400000).toLocaleDateString('en')} — ${new Date().toLocaleDateString('en')}`, MARGIN, 285);

    // Summary stats on cover
    const coverStats = [
      { val: `${d.monitors.up}/${d.monitors.total}`, label: 'Monitors Up',   color: C.green },
      { val: d.monitors.avg_latency_ms != null ? `${d.monitors.avg_latency_ms}ms` : '—', label: 'Avg Latency', color: C.accent },
      { val: d.licences.total,  label: 'Licences',    color: C.accent },
      { val: d.entra.total,     label: 'Entra Apps',  color: C.accent },
    ];
    const bw = PW / coverStats.length;
    coverStats.forEach((s, i) => {
      const bx = MARGIN + i * bw;
      doc.rect(bx + 4, 340, bw - 8, 70).fill('#1E293B');
      doc.rect(bx + 4, 340, bw - 8, 3).fill(s.color);
      doc.fillColor(s.color).fontSize(22).font('Helvetica-Bold')
        .text(safe(s.val), bx + 4, 352, { width: bw - 8, align: 'center' });
      doc.fillColor(C.gray4).fontSize(8).font('Helvetica')
        .text(s.label.toUpperCase(), bx + 4, 378, { width: bw - 8, align: 'center' });
    });

    // Footer line on cover
    doc.rect(MARGIN, H - 60, PW, 0.5).fill(C.primary2);
    doc.fillColor(C.gray4).fontSize(8).text('CONFIDENTIAL — IT INFRASTRUCTURE REPORT', MARGIN, H - 45, { width: PW, align: 'center' });

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — UPTIME MONITORS
    // ════════════════════════════════════════════════════════════════════════
    addPage();
    sectionTitle('Uptime Monitors');

    // Stat boxes
    const msw = (PW - 12) / 4;
    const msy = doc.y;
    statBox(MARGIN,           msy, msw - 3, 48, d.monitors.up,       'Up',        C.green);
    statBox(MARGIN + msw,     msy, msw - 3, 48, d.monitors.down,     'Down',      d.monitors.down > 0 ? C.red : C.gray4);
    statBox(MARGIN + msw * 2, msy, msw - 3, 48, d.monitors.degraded, 'Degraded',  d.monitors.degraded > 0 ? C.orange : C.gray4);
    statBox(MARGIN + msw * 3, msy, msw - 3, 48, d.monitors.avg_latency_ms != null ? `${d.monitors.avg_latency_ms}ms` : '—', 'Avg Latency', C.accent);
    doc.y = msy + 60;

    const mCols = [
      { label: 'Monitor',  w: 160 },
      { label: 'Target',   w: 200 },
      { label: 'Status',   w: 70  },
      { label: 'Latency',  w: 85  },
    ];
    tHead(mCols);
    (d.monitors.all || []).forEach((m, i) => {
      const sc = statusColor(m.last_status);
      tRow(mCols, [m.label, m.target, m.last_status || '—', m.last_latency_ms != null ? `${m.last_latency_ms} ms` : '—'], i % 2 === 1, { 2: sc });
    });

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 3 — INTERNET SPEED
    // ════════════════════════════════════════════════════════════════════════
    if (d.speed.tests > 0) {
      addPage();
      sectionTitle('Internet Speed');
      const sw = (PW - 8) / 3;
      const sy = doc.y;
      statBox(MARGIN,          sy, sw - 4, 48, d.speed.avg_download != null ? `${d.speed.avg_download} Mbps` : '—', 'Avg Download', C.accent);
      statBox(MARGIN + sw,     sy, sw - 4, 48, d.speed.avg_upload   != null ? `${d.speed.avg_upload} Mbps`   : '—', 'Avg Upload',   C.green);
      statBox(MARGIN + sw * 2, sy, sw - 4, 48, d.speed.avg_ping     != null ? `${d.speed.avg_ping} ms`        : '—', 'Avg Ping',     C.primary2);
      doc.y = sy + 60;
      if (d.speed.last) {
        doc.moveDown(0.3);
        kv('Last test date',     new Date(d.speed.last.created_at + 'Z').toLocaleString('en'));
        kv('Last download',      `${fmtN(d.speed.last.download, 1)} Mbps`);
        kv('Last upload',        `${fmtN(d.speed.last.upload,   1)} Mbps`);
        kv('Last ping',          `${fmtN(d.speed.last.ping, 0)} ms`);
      }
      kv('Total tests in period', d.speed.tests);
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 4 — LICENCES & COSTS
    // ════════════════════════════════════════════════════════════════════════
    addPage();
    sectionTitle('Licences & Costs');

    const lsw = (PW - 6) / 3;
    const lsy = doc.y;
    statBox(MARGIN,           lsy, lsw - 3, 48, d.licences.total,     'Total',          C.accent);
    statBox(MARGIN + lsw,     lsy, lsw - 3, 48, d.licences.paid,      'Paid',           C.primary2);
    statBox(MARGIN + lsw * 2, lsy, lsw - 3, 48, d.licences.free,      'Free',           C.green);
    doc.y = lsy + 60;

    // Cost by currency table
    if (d.licences.cost_by_currency && Object.keys(d.licences.cost_by_currency).length) {
      doc.moveDown(0.3);
      const ccols = [
        { label: 'Currency', w: 80  },
        { label: 'Monthly (net)', w: 120 },
        { label: 'Annual (net)', w: 120  },
        { label: 'Annual (incl. tax)', w: 130 },
      ];
      tHead(ccols);
      Object.entries(d.licences.cost_by_currency).forEach(([cur, costs], i) => {
        tRow(ccols, [cur, `${fmtN(costs.net_monthly)} ${cur}`, `${fmtN(costs.net_annual)} ${cur}`, `${fmtN(costs.gross_annual)} ${cur}`], i % 2 === 1, { 3: C.primary2 });
      });
    }

    // Expiry warnings
    if (d.licences.expiring_30 > 0 || d.licences.expired > 0) {
      doc.moveDown(0.5);
      if (d.licences.expiring_30 > 0) kv('Expiring in 30 days', d.licences.expiring_30, C.red);
      if (d.licences.expired > 0)     kv('Expired',             d.licences.expired,     C.red);
    }

    // Free licences list
    if (d.licences.free_list?.length) {
      doc.moveDown(0.3);
      doc.fillColor(C.gray3).fontSize(8).font('Helvetica-Bold').text('FREE LICENCES', MARGIN, doc.y);
      doc.moveDown(0.3);
      d.licences.free_list.forEach(l => {
        doc.fillColor(C.green).fontSize(8).font('Helvetica')
          .text(`✓  ${l.vendor} — ${l.licence_type}  (${l.licence_count} seats)`, MARGIN + 8, doc.y);
        doc.moveDown(0.3);
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 5 — EMAIL ACTIVITY
    // ════════════════════════════════════════════════════════════════════════
    if (d.mailFlowMonthly?.months?.length || d.mailFlow?.domains?.length) {
      addPage();
      sectionTitle('Email Activity — M365');

      // Monthly table
      if (d.mailFlowMonthly?.months?.length) {
        const emCols = [
          { label: 'Month',    w: 120 },
          { label: 'Sent',     w: 100 },
          { label: 'Received', w: 110 },
          { label: 'Read',     w: 100 },
          { label: 'Total',    w: 85  },
        ];
        tHead(emCols);
        d.mailFlowMonthly.months.forEach((m, i) => {
          tRow(emCols, [m.label, fmtI(m.send), fmtI(m.receive), fmtI(m.read), fmtI(m.send + m.receive)], i % 2 === 1, { 1: C.accent, 2: C.green, 3: C.primary2 });
        });
        if (d.mailFlowMonthly.trend != null) {
          doc.moveDown(0.3);
          const trendColor = d.mailFlowMonthly.trend < 0 ? C.red : C.green;
          const trendSign  = d.mailFlowMonthly.trend > 0 ? '+' : '';
          kv('Trend vs prev month', `${trendSign}${fmtI(d.mailFlowMonthly.trend)} sent`, trendColor);
        }
      }

      // By domain
      if (d.mailFlow?.domains?.length) {
        doc.moveDown(0.5);
        doc.fillColor(C.gray3).fontSize(8).font('Helvetica-Bold').text('BY DOMAIN', MARGIN, doc.y);
        doc.moveDown(0.3);
        const dmCols = [
          { label: 'Domain',   w: 200 },
          { label: 'Sent',     w: 100 },
          { label: 'Received', w: 110 },
          { label: 'Read',     w: 105 },
        ];
        tHead(dmCols);
        d.mailFlow.domains.forEach((dm, i) => {
          tRow(dmCols, [`@${dm.domain}`, fmtI(dm.send), fmtI(dm.receive), fmtI(dm.read)], i % 2 === 1, { 1: C.accent, 2: C.green, 3: C.primary2 });
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 6 — DNS EXTERNAL SECURITY
    // ════════════════════════════════════════════════════════════════════════
    if (d.dnsExternal?.length) {
      addPage();
      sectionTitle('DNS — External Domain Security');

      const dnsCols = [
        { label: 'Domain', w: 200 },
        { label: 'SPF',    w: 65  },
        { label: 'DKIM',   w: 65  },
        { label: 'DMARC',  w: 65  },
        { label: 'MX',     w: 65  },
        { label: 'Score',  w: 55  },
      ];
      tHead(dnsCols);
      d.dnsExternal.forEach((dm, i) => {
        const sc = dm.score === 4 ? C.green : dm.score >= 2 ? C.orange : C.red;
        tRow(dnsCols, [
          dm.domain,
          checkMark(dm.spf),
          checkMark(dm.dkim),
          checkMark(dm.dmarc),
          checkMark(dm.mx),
          `${dm.score}/4`,
        ], i % 2 === 1, {
          1: dm.spf   ? C.green : C.red,
          2: dm.dkim  ? C.green : C.red,
          3: dm.dmarc ? C.green : C.red,
          4: dm.mx    ? C.green : C.red,
          5: sc,
        });
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 7 — PROXMOX
    // ════════════════════════════════════════════════════════════════════════
    if (d.proxmox?.configured && d.proxmox.nodes.length) {
      addPage();
      sectionTitle('Proxmox Infrastructure');

      const pCols = [
        { label: 'Node',      w: 90  },
        { label: 'Status',    w: 65  },
        { label: 'CPU cores', w: 75  },
        { label: 'CPU %',     w: 55  },
        { label: 'RAM (GB)',  w: 110 },
        { label: 'RAM %',     w: 55  },
        { label: 'VMs',       w: 55  },
        { label: 'LXC',       w: 55  },
      ];

      const totalVMs  = d.proxmox.nodes.reduce((a, n) => a + n.vm_count,  0);
      const totalLXC  = d.proxmox.nodes.reduce((a, n) => a + n.lxc_count, 0);
      const totalCPU  = d.proxmox.nodes.reduce((a, n) => a + n.maxcpu,    0);
      const totalRAM  = d.proxmox.nodes.reduce((a, n) => a + parseFloat(n.maxmem_gb || 0), 0);
      const rVMs      = d.proxmox.nodes.reduce((a, n) => a + n.vm_running,  0);
      const rLXC      = d.proxmox.nodes.reduce((a, n) => a + n.lxc_running, 0);

      const psw = (PW - 10) / 4;
      const psy = doc.y;
      statBox(MARGIN,           psy, psw - 3, 48, d.proxmox.nodes.length, 'Nodes',      C.accent);
      statBox(MARGIN + psw,     psy, psw - 3, 48, `${totalCPU}`,          'Total cores', C.primary2);
      statBox(MARGIN + psw * 2, psy, psw - 3, 48, `${totalRAM.toFixed(0)} GB`, 'Total RAM', C.primary2);
      statBox(MARGIN + psw * 3, psy, psw - 3, 48, `${rVMs + rLXC}/${totalVMs + totalLXC}`, 'Running', C.green);
      doc.y = psy + 60;

      tHead(pCols);
      d.proxmox.nodes.forEach((n, i) => {
        tRow(pCols, [
          n.node, n.status,
          safe(n.maxcpu), `${n.cpu_usage}%`,
          `${n.mem_used_gb} / ${n.maxmem_gb}`, `${n.mem_usage}%`,
          `${n.vm_running}/${n.vm_count}`, `${n.lxc_running}/${n.lxc_count}`,
        ], i % 2 === 1, {
          1: n.status === 'online' ? C.green : C.red,
          3: n.cpu_usage > 80 ? C.red : n.cpu_usage > 60 ? C.orange : C.gray2,
          5: n.mem_usage > 80 ? C.red : n.mem_usage > 60 ? C.orange : C.gray2,
        });
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 8 — ENTRA ID
    // ════════════════════════════════════════════════════════════════════════
    if (d.entra?.total > 0) {
      addPage();
      sectionTitle('Entra ID App Registrations');

      const esw = (PW - 6) / 3;
      const esy = doc.y;
      statBox(MARGIN,           esy, esw - 3, 48, d.entra.total,       'Total Apps',          C.accent);
      statBox(MARGIN + esw,     esy, esw - 3, 48, d.entra.expiring_30, 'Expiring this month', d.entra.expiring_30 > 0 ? C.red : C.gray4);
      statBox(MARGIN + esw * 2, esy, esw - 3, 48, d.entra.total - d.entra.expiring_30, 'OK', C.green);
      doc.y = esy + 70;

      const eCols = [
        { label: 'App Name',      w: 220 },
        { label: 'Secret Expiry', w: 110 },
        { label: 'Days left',     w: 90  },
        { label: 'Status',        w: 95  },
      ];
      tHead(eCols);
      d.entra.list.forEach((a, i) => {
        const days  = a.secret_expiry ? Math.ceil((new Date(a.secret_expiry) - new Date()) / 86400000) : null;
        const sc    = days != null && days <= 0 ? C.red : days != null && days <= 30 ? C.orange : C.green;
        const label = days == null ? '—' : days <= 0 ? 'EXPIRED' : days <= 30 ? 'EXPIRING' : 'OK';
        tRow(eCols, [a.app_name, a.secret_expiry || '—', days != null ? `${days}d` : '—', label], i % 2 === 1, { 3: sc });
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // FOOTER ON ALL PAGES
    // ════════════════════════════════════════════════════════════════════════
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, H - 28, W, 28).fill('#0F172A');
      doc.fillColor(C.gray4).fontSize(7.5).font('Helvetica')
        .text(`${appName}  ·  Infrastructure Report  ·  ${new Date().toLocaleDateString('en')}`, MARGIN, H - 18, { width: PW * 0.7 });
      doc.fillColor(C.gray4).fontSize(7.5)
        .text(`Page ${i + 1} of ${range.count}`, MARGIN, H - 18, { width: PW, align: 'right' });
      // Reapply top accent bar
      if (i > 0) {
        doc.rect(0, 0, W, 6).fill(C.primary);
      }
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
