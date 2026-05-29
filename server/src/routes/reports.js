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
  let doc;
  try {
    const period = Math.min(parseInt(req.query.period) || 30, 365);
    const d      = await gatherReportData(period);
    const PDFDocument = require('pdfkit');
    doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true, autoFirstPage: false });
    const appName = db.prepare("SELECT value FROM settings WHERE key='app_name'").get()?.value || 'Krajcara Admin';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().split('T')[0]}.pdf"`);
    res.on('error', () => { try { doc.end(); } catch {} });
    doc.on('error', (err) => { console.error('[PDF]', err.message); });
    doc.pipe(res);

    const W = 595.28, H = 841.89, M = 40, PW = W - M * 2;
    const C = {
      dark: '#0F172A', dark2: '#1E293B', primary: '#1E40AF', accent: '#3B82F6',
      green: '#16A34A', red: '#DC2626', orange: '#EA580C', purple: '#7C3AED',
      w: '#FFFFFF', g1: '#111827', g2: '#374151', g3: '#6B7280', g4: '#9CA3AF', g5: '#E5E7EB', g6: '#F1F5F9',
    };

    const safe = (v, f='—') => (v != null && v !== '') ? String(v) : f;
    const fmtN = (n, dec=2) => n != null && !isNaN(n) ? Number(n).toLocaleString('en',{minimumFractionDigits:dec,maximumFractionDigits:dec}) : '—';
    const fmtI = (n) => n != null && !isNaN(n) ? Number(n).toLocaleString('en') : '—';

    // ── Draw page background ──────────────────────────────────────────────
    const pageBg = () => {
      doc.rect(0, 0, W, H).fill(C.dark);
      // subtle gradient circles
      doc.save().fillColor('#1E3A5F').opacity(0.2).circle(W+60, 100, 220).fill().restore();
      doc.save().fillColor('#1E3A5F').opacity(0.15).circle(-40, H-60, 180).fill().restore();
      // top accent bar
      doc.rect(0, 0, W, 5).fill(C.primary);
    };

    // ── Section title ─────────────────────────────────────────────────────
    let curY = 0;
    const sec = (title) => {
      curY += 18;
      doc.rect(M, curY, 3, 14).fill(C.accent);
      doc.fillColor(C.accent).fontSize(9).font('Helvetica-Bold').text(title.toUpperCase(), M+8, curY+2);
      doc.rect(M, curY+15, PW, 0.4).fill('#1E3A5F');
      curY += 22;
    };

    // ── Stat box ──────────────────────────────────────────────────────────
    const stat = (x, y, w, h, val, label, color=C.accent) => {
      doc.rect(x, y, w, h).fill(C.dark2);
      doc.rect(x, y, w, 3).fill(color);
      doc.fillColor(color).fontSize(15).font('Helvetica-Bold').text(safe(val), x, y+10, {width:w, align:'center'});
      doc.fillColor(C.g4).fontSize(6.5).font('Helvetica').text(label.toUpperCase(), x, y+28, {width:w, align:'center'});
    };

    // ── Table header ──────────────────────────────────────────────────────
    const th = (cols) => {
      doc.rect(M, curY, PW, 14).fill(C.primary);
      let x = M;
      cols.forEach(col => {
        doc.fillColor(C.w).fontSize(6.5).font('Helvetica-Bold').text(col.l.toUpperCase(), x+3, curY+4, {width:col.w-4, ellipsis:true});
        x += col.w;
      });
      curY += 14;
    };

    // ── Table row ─────────────────────────────────────────────────────────
    const tr = (cols, vals, alt=false, clrs={}) => {
      const rh = 13;
      if (alt) doc.rect(M, curY, PW, rh).fill('#1A2744');
      doc.rect(M, curY+rh-0.4, PW, 0.4).fill('#1E3A5F');
      let x = M;
      cols.forEach((col, i) => {
        doc.fillColor(clrs[i]||C.g3).fontSize(7).font(clrs[i]?'Helvetica-Bold':'Helvetica')
          .text(safe(vals[i]), x+3, curY+3, {width:col.w-5, ellipsis:true});
        x += col.w;
      });
      doc.fillColor(C.g2).font('Helvetica');
      curY += rh;
    };

    const kv = (label, val, color=null) => {
      doc.fillColor(C.g4).fontSize(7.5).font('Helvetica').text(label, M, curY, {width:180});
      doc.fillColor(color||C.w).fontSize(7.5).font('Helvetica-Bold').text(safe(val), M+190, curY, {width:PW-190});
      curY += 12;
    };

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({size:'A4', margin:0});
    pageBg();

    // Logo
    doc.rect(M, 80, 48, 48).fill(C.primary);
    doc.fillColor(C.w).fontSize(24).font('Helvetica-Bold').text('K', M, 94, {width:48, align:'center'});

    // Title
    doc.fillColor(C.w).fontSize(26).font('Helvetica-Bold').text(appName, M+58, 84);
    doc.fillColor(C.accent).fontSize(12).font('Helvetica').text('Infrastructure Report', M+58, 116);
    doc.rect(M, 150, PW, 0.6).fill('#1D4ED8');

    // Period pill
    doc.rect(M, 162, 100, 20).fill(C.primary);
    doc.fillColor(C.w).fontSize(8.5).font('Helvetica-Bold').text(`Last ${period} days`, M, 168, {width:100, align:'center'});
    doc.fillColor(C.g4).fontSize(8).font('Helvetica')
      .text(`Generated: ${new Date().toLocaleString('en')}`, M+110, 164)
      .text(`${new Date(Date.now()-period*86400000).toLocaleDateString('en')} — ${new Date().toLocaleDateString('en')}`, M+110, 176);

    // Row 1 — Monitors + Speed
    const r1y = 210, bw = (PW-12)/4;
    [[`${d.monitors.up}/${d.monitors.total}`,'Monitors Up',C.green],
     [d.monitors.down>0?d.monitors.down:'0','Monitors Down',d.monitors.down>0?C.red:C.g4],
     [d.speed.avg_download!=null?`${d.speed.avg_download}M`:'—','Avg Download',C.accent],
     [d.speed.avg_upload!=null?`${d.speed.avg_upload}M`:'—','Avg Upload',C.green],
    ].forEach(([v,l,c],i) => stat(M+i*(bw+4), r1y, bw, 52, v, l, c));

    // Row 2 — Licences + Entra + Ping
    const r2y = 274;
    [[d.licences.total,'Total Licences',C.accent],
     [d.licences.paid,'Paid',C.primary],
     [d.licences.free,'Free',C.green],
     [d.entra.total,'Entra Apps',C.purple],
    ].forEach(([v,l,c],i) => stat(M+i*(bw+4), r2y, bw, 52, v, l, c));

    // Costs table
    curY = 344;
    if (d.licences.cost_by_currency && Object.keys(d.licences.cost_by_currency).length) {
      doc.fillColor(C.g4).fontSize(7).font('Helvetica-Bold').text('LICENCE COSTS', M, curY); curY += 12;
      const ccols = [{l:'Currency',w:65},{l:'Monthly net',w:100},{l:'Annual net',w:100},{l:'Annual incl.tax',w:100}];
      th(ccols);
      Object.entries(d.licences.cost_by_currency).forEach(([cur,costs],i) => {
        tr(ccols,[cur,`${fmtN(costs.net_monthly)} ${cur}`,`${fmtN(costs.net_annual)} ${cur}`,`${fmtN(costs.gross_annual)} ${cur}`],i%2===1,{3:C.accent});
      });
    }

    // Proxmox summary on cover
    if (d.proxmox?.configured && d.proxmox.nodes.length) {
      curY += 10;
      const totalCPU = d.proxmox.nodes.reduce((a,n)=>a+n.maxcpu,0);
      const totalRAM = d.proxmox.nodes.reduce((a,n)=>a+parseFloat(n.maxmem_gb||0),0);
      const rVMs = d.proxmox.nodes.reduce((a,n)=>a+n.vm_running,0);
      const tVMs = d.proxmox.nodes.reduce((a,n)=>a+n.vm_count,0);
      const rLXC = d.proxmox.nodes.reduce((a,n)=>a+n.lxc_running,0);
      const tLXC = d.proxmox.nodes.reduce((a,n)=>a+n.lxc_count,0);
      doc.fillColor(C.g4).fontSize(7).font('Helvetica-Bold').text('PROXMOX INFRASTRUCTURE', M, curY); curY += 12;
      const pcols = [{l:'Node',w:80},{l:'Status',w:65},{l:'Cores',w:55},{l:'CPU%',w:50},{l:'RAM GB',w:90},{l:'RAM%',w:50},{l:'VMs',w:50},{l:'LXC',w:45}];
      th(pcols);
      d.proxmox.nodes.forEach((n,i) => {
        tr(pcols,[n.node,n.status,n.maxcpu,`${n.cpu_usage}%`,`${n.mem_used_gb}/${n.maxmem_gb}`,`${n.mem_usage}%`,`${n.vm_running}/${n.vm_count}`,`${n.lxc_running}/${n.lxc_count}`],i%2===1,{
          1:n.status==='online'?C.green:C.red,
          3:n.cpu_usage>80?C.red:n.cpu_usage>60?C.orange:C.w,
          5:n.mem_usage>80?C.red:n.mem_usage>60?C.orange:C.w,
        });
      });
      curY += 4;
      doc.fillColor(C.g4).fontSize(7).font('Helvetica')
        .text(`Totals: ${d.proxmox.nodes.length} nodes · ${totalCPU} cores · ${totalRAM.toFixed(0)} GB RAM · ${rVMs+rLXC}/${tVMs+tLXC} running`, M, curY);
    }

    // Cover footer
    doc.rect(0, H-30, W, 30).fill('#050D1A');
    doc.fillColor(C.g4).fontSize(7).font('Helvetica')
      .text('CONFIDENTIAL — IT INFRASTRUCTURE REPORT', M, H-18, {width:PW, align:'center'});

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — EMAIL + DNS + ENTRA
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({size:'A4', margin:0});
    pageBg();
    curY = 20;

    // Email Activity
    if (d.mailFlowMonthly?.months?.length) {
      sec('Email Activity — M365');
      const emCols = [{l:'Month',w:85},{l:'Sent',w:75},{l:'Received',w:85},{l:'Read',w:75},{l:'Total',w:70}];
      th(emCols);
      d.mailFlowMonthly.months.forEach((m,i) => {
        tr(emCols,[m.label,fmtI(m.send),fmtI(m.receive),fmtI(m.read),fmtI(m.send+m.receive)],i%2===1,{1:C.accent,2:C.green,3:C.purple});
      });
      if (d.mailFlowMonthly.trend!=null) {
        curY += 4;
        const tc = d.mailFlowMonthly.trend<0?C.red:C.green;
        const ts = d.mailFlowMonthly.trend>0?'+':'';
        kv('Trend vs prev month', `${ts}${fmtI(d.mailFlowMonthly.trend)} sent`, tc);
      }
      if (d.mailFlow?.domains?.length) {
        curY += 6;
        doc.fillColor(C.g4).fontSize(7).font('Helvetica-Bold').text('BY DOMAIN', M, curY); curY += 10;
        const dmCols = [{l:'Domain',w:155},{l:'Sent',w:80},{l:'Received',w:90},{l:'Read',w:90}];
        th(dmCols);
        d.mailFlow.domains.forEach((dm,i) => {
          tr(dmCols,[`@${dm.domain}`,fmtI(dm.send),fmtI(dm.receive),fmtI(dm.read)],i%2===1,{1:C.accent,2:C.green,3:C.purple});
        });
      }
    }

    // DNS External
    if (d.dnsExternal?.length) {
      sec('DNS — External Domain Security');
      const dnsCols = [{l:'Domain',w:155},{l:'SPF',w:50},{l:'DKIM',w:50},{l:'DMARC',w:55},{l:'MX',w:50},{l:'Score',w:55}];
      th(dnsCols);
      d.dnsExternal.forEach((dm,i) => {
        const sc = dm.score===4?C.green:dm.score>=2?C.orange:C.red;
        const ck = v => v?'✓':'✗';
        tr(dnsCols,[dm.domain,ck(dm.spf),ck(dm.dkim),ck(dm.dmarc),ck(dm.mx),`${dm.score}/4`],i%2===1,{
          1:dm.spf?C.green:C.red,2:dm.dkim?C.green:C.red,3:dm.dmarc?C.green:C.red,4:dm.mx?C.green:C.red,5:sc,
        });
      });
    }

    // Entra ID
    if (d.entra?.total > 0) {
      sec('Entra ID App Registrations');
      const esw = (PW-6)/3;
      const esy = curY;
      stat(M,       esy, esw-3, 48, d.entra.total,                      'Total Apps',         C.accent);
      stat(M+esw,   esy, esw-3, 48, d.entra.expiring_30,                 'Expiring this month', d.entra.expiring_30>0?C.red:C.g4);
      stat(M+esw*2, esy, esw-3, 48, d.entra.total-d.entra.expiring_30,  'OK',                  C.green);
      curY = esy + 52;
    }

    // Page footer
    doc.rect(0, H-30, W, 30).fill('#050D1A');
    doc.fillColor(C.g4).fontSize(7).font('Helvetica')
      .text(`${appName}  ·  Infrastructure Report  ·  ${new Date().toLocaleDateString('en')}`, M, H-18, {width:PW*0.7})
      .text('Page 2 of 2', M, H-18, {width:PW, align:'right'});

    // Fix page 1 footer page number
    doc.switchToPage(0);
    doc.fillColor(C.g4).fontSize(7).font('Helvetica')
      .text('Page 1 of 2', M, H-18, {width:PW, align:'right'});

    doc.flushPages();
    doc.end();

  } catch (err) {
    console.error('[Reports] PDF error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      try { if (doc) doc.end(); } catch {}
    }
  }
});

module.exports = router;
