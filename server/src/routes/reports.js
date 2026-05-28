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
  const freeLicences   = licences.filter(l => !parseFloat(l.price_per_licence));
  const paidLicences   = licences.filter(l => parseFloat(l.price_per_licence) > 0);
  let totalCostAnnual = 0, totalCostMonthly = 0;
  for (const l of paidLicences) {
    const p = parseFloat(l.price_per_licence) || 0;
    const c = parseInt(l.licence_count) || 1;
    if (l.billing_cycle === 'monthly') { totalCostMonthly += p * c; totalCostAnnual += p * c * 12; }
    else if (l.billing_cycle === 'annual') { totalCostMonthly += (p * c) / 12; totalCostAnnual += p * c; }
  }
  totalCostAnnual  = Math.round(totalCostAnnual  * 100) / 100;
  totalCostMonthly = Math.round(totalCostMonthly * 100) / 100;

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

  return {
    period,
    generated_at: new Date().toISOString(),
    monitors:     { total: monitors.length, up: monitorsUp, down: monitorsDown, degraded: monitorsDeg, avg_latency_ms: avgLatency, top_latency: topLatency, all: monitors },
    speed:        { tests: speedTests.length, avg_download: avgDownload, avg_upload: avgUpload, avg_ping: avgPing, last: lastSpeed, history: speedTests.slice(0, 30).reverse() },
    licences:     { total: licences.length, paid: paidLicences.length, free: freeLicences.length, expiring_30: expiring30.length, expiring_60: expiring60, expired: expired.length, annual_cost: totalCostAnnual, monthly_cost: totalCostMonthly, list: licences, free_list: freeLicences },
    entra:        { total: entraApps.length, expiring_30: entraExpiring.length, list: entraApps },
    notifications:{ total: notifications.length, by_type: notifByType, by_module: notifByModule, recent: notifications.slice(0, 10) },
    network:      { routers: routers.length, dns: dnsServers.length },
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
    const doc    = new PDFDocument({ margin: 50, size: 'A4' });
    const appName = db.prepare("SELECT value FROM settings WHERE key='app_name'").get()?.value || 'Krajcara Admin';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // ── Colors & helpers ─────────────────────────────────────────────────────
    const BLUE   = '#1A56A0';
    const GRAY   = '#6B7280';
    const GREEN  = '#16A34A';
    const RED    = '#DC2626';
    const ORANGE = '#EA580C';
    const LIGHT  = '#F3F4F6';
    const pageW  = doc.page.width - 100;

    const section = (title) => {
      doc.moveDown(0.5);
      doc.rect(50, doc.y, pageW, 22).fill(BLUE);
      doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
        .text(title, 58, doc.y - 18);
      doc.fillColor('black').font('Helvetica').fontSize(9);
      doc.moveDown(0.8);
    };

    const row = (label, value, color = 'black') => {
      const y = doc.y;
      doc.fillColor(GRAY).text(label, 50, y, { width: 200 });
      doc.fillColor(color).font('Helvetica-Bold').text(String(value), 260, y);
      doc.font('Helvetica').fillColor('black');
      doc.moveDown(0.4);
    };

    const tableHeader = (cols) => {
      const y = doc.y;
      doc.rect(50, y, pageW, 18).fill(LIGHT);
      let x = 50;
      for (const col of cols) {
        doc.fillColor(GRAY).fontSize(8).font('Helvetica-Bold')
          .text(col.label, x + 4, y + 4, { width: col.width - 4 });
        x += col.width;
      }
      doc.fillColor('black').font('Helvetica').fontSize(9);
      doc.y = y + 18;
    };

    const tableRow = (cols, values, alt = false) => {
      const y   = doc.y;
      const rowH = 16;
      if (alt) doc.rect(50, y, pageW, rowH).fill('#F9FAFB');
      let x = 50;
      for (let i = 0; i < cols.length; i++) {
        const val   = String(values[i] ?? '—');
        const color = cols[i].color ? cols[i].color(values[i]) : 'black';
        doc.fillColor(color).fontSize(8).text(val, x + 4, y + 3, { width: cols[i].width - 8 });
        x += cols[i].width;
      }
      doc.fillColor('black');
      doc.y = y + rowH;
    };

    // ── Cover ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 120).fill(BLUE);
    doc.fillColor('white').fontSize(24).font('Helvetica-Bold')
      .text(appName, 50, 35);
    doc.fontSize(13).font('Helvetica')
      .text(`Infrastructure Report — Last ${period} days`, 50, 68);
    doc.fontSize(9)
      .text(`Generated: ${new Date().toLocaleString('en')}`, 50, 90);
    doc.fillColor('black').fontSize(9).font('Helvetica');
    doc.y = 140;

    // ── Summary ──────────────────────────────────────────────────────────────
    section('SUMMARY');
    row('Report period', `Last ${period} days`);
    row('Monitors', `${d.monitors.up} up / ${d.monitors.down} down / ${d.monitors.degraded} degraded`, d.monitors.down > 0 ? RED : GREEN);
    row('Average latency', d.monitors.avg_latency_ms != null ? `${d.monitors.avg_latency_ms} ms` : '—');
    row('Licences', `${d.licences.total} total, ${d.licences.expiring_30} expiring in 30 days`, d.licences.expiring_30 > 0 ? ORANGE : 'black');
    row('Entra ID Apps', `${d.entra.total} total, ${d.entra.expiring_30} secrets expiring`, d.entra.expiring_30 > 0 ? ORANGE : 'black');
    row('Notifications', `${d.notifications.total} in period (${d.notifications.by_type.error || 0} errors, ${d.notifications.by_type.warning || 0} warnings)`);
    row('Annual licence cost', `${d.licences.annual_cost.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);

    // ── Uptime Monitors ──────────────────────────────────────────────────────
    doc.addPage();
    section('UPTIME MONITORS');

    // Stats row
    const statBoxes = [
      { label: 'Total',    value: d.monitors.total,    color: BLUE },
      { label: 'Up',       value: d.monitors.up,       color: GREEN },
      { label: 'Down',     value: d.monitors.down,     color: d.monitors.down > 0 ? RED : GRAY },
      { label: 'Degraded', value: d.monitors.degraded, color: d.monitors.degraded > 0 ? ORANGE : GRAY },
    ];
    const boxW = pageW / statBoxes.length;
    const boxY = doc.y;
    statBoxes.forEach((b, i) => {
      doc.rect(50 + i * boxW, boxY, boxW - 4, 44).fill(LIGHT);
      doc.fillColor(b.color).fontSize(20).font('Helvetica-Bold')
        .text(String(b.value), 50 + i * boxW, boxY + 6, { width: boxW - 4, align: 'center' });
      doc.fillColor(GRAY).fontSize(8).font('Helvetica')
        .text(b.label, 50 + i * boxW, boxY + 28, { width: boxW - 4, align: 'center' });
    });
    doc.y = boxY + 54;

    // Monitors table
    const mCols = [
      { label: 'Monitor', width: 180 },
      { label: 'Target',  width: 180 },
      { label: 'Status',  width: 70, color: v => ({ up: GREEN, down: RED, degraded: ORANGE }[v] || GRAY) },
      { label: 'Latency', width: 70 },
    ];
    tableHeader(mCols);
    const allMonitors = db.prepare('SELECT * FROM monitors WHERE enabled=1 ORDER BY label').all();
    allMonitors.forEach((m, i) => tableRow(mCols, [m.label, m.target, m.last_status || '—', m.last_latency_ms != null ? `${m.last_latency_ms} ms` : '—'], i % 2 === 1));

    if (d.monitors.top_latency.length) {
      doc.moveDown(0.5);
      section('TOP 5 MONITORS BY LATENCY');
      const lCols = [{ label: 'Monitor', width: 280 }, { label: 'Status', width: 100 }, { label: 'Latency', width: 120 }];
      tableHeader(lCols);
      d.monitors.top_latency.forEach((m, i) => tableRow(lCols, [m.label, m.status, `${m.latency_ms} ms`], i % 2 === 1));
    }

    // ── Network Speed ────────────────────────────────────────────────────────
    doc.addPage();
    section(`INTERNET SPEED (last ${period} days)`);
    row('Tests performed', d.speed.tests);
    row('Avg download',  d.speed.avg_download != null ? `${d.speed.avg_download} Mbps` : '—');
    row('Avg upload',    d.speed.avg_upload   != null ? `${d.speed.avg_upload} Mbps`   : '—');
    row('Avg ping',      d.speed.avg_ping     != null ? `${d.speed.avg_ping} ms`        : '—');
    if (d.speed.last) {
      row('Last test',   new Date(d.speed.last.created_at + 'Z').toLocaleString('en'));
      row('Last download', `${Math.round(d.speed.last.download * 10) / 10} Mbps`);
      row('Last upload',   `${Math.round(d.speed.last.upload   * 10) / 10} Mbps`);
      row('Last ping',     `${Math.round(d.speed.last.ping)} ms`);
    }

    // ── Licences ─────────────────────────────────────────────────────────────
    doc.addPage();
    section('LICENCES & COSTS');
    row('Total licences',           d.licences.total);
    row('Paid licences',            d.licences.paid);
    row('Free licences',            d.licences.free, GREEN);
    row('Expiring in 30 days',      d.licences.expiring_30, d.licences.expiring_30 > 0 ? RED : 'black');
    row('Expiring in 60 days',      d.licences.expiring_60.length, d.licences.expiring_60.length > 0 ? ORANGE : 'black');
    row('Expired',                  d.licences.expired, d.licences.expired > 0 ? RED : 'black');
    row('Monthly cost (est.)',      `${d.licences.monthly_cost.toLocaleString('en', { minimumFractionDigits: 2 })} EUR`);
    row('Annual cost (est.)',       `${d.licences.annual_cost.toLocaleString('en', { minimumFractionDigits: 2 })} EUR`);
    if (d.licences.free_list.length) {
      doc.moveDown(0.3);
      doc.fillColor(GRAY).fontSize(9).text('Free licences:', 50, doc.y);
      doc.moveDown(0.3);
      d.licences.free_list.forEach(l => {
        doc.fillColor(GREEN).fontSize(8).text(`  ✓ ${l.vendor} — ${l.licence_type} (${l.licence_count} seats)`, 50, doc.y);
        doc.moveDown(0.3);
      });
      doc.fillColor('black').fontSize(9);
    }
    doc.moveDown(0.3);

    const lCols2 = [
      { label: 'Vendor',       width: 120 },
      { label: 'Type',         width: 120 },
      { label: 'Seats',        width: 60 },
      { label: 'Billing',      width: 70 },
      { label: 'Expiry',       width: 90 },
      { label: 'Price/seat',   width: 80 },
    ];
    tableHeader(lCols2);
    d.licences.list.forEach((l, i) => {
      const days = l.expiry_date ? Math.ceil((new Date(l.expiry_date) - new Date()) / 86400000) : null;
      const expColor = days != null && days <= 0 ? RED : days != null && days <= 30 ? ORANGE : 'black';
      tableRow(lCols2, [
        l.vendor, l.licence_type,
        `${l.licence_used || 0}/${l.licence_count}`,
        l.billing_cycle || '—',
        l.expiry_date || '—',
        l.price_per_licence ? `${l.price_per_licence} ${l.currency || 'EUR'}` : '—',
      ], i % 2 === 1);
    });

    // ── Proxmox ──────────────────────────────────────────────────────────────
    if (d.proxmox?.configured && d.proxmox.nodes.length) {
      doc.addPage();
      section('PROXMOX INFRASTRUCTURE');
      const pCols = [
        { label: 'Node',      width: 80  },
        { label: 'Status',    width: 60  },
        { label: 'CPU cores', width: 70  },
        { label: 'CPU %',     width: 55  },
        { label: 'RAM (GB)',  width: 90  },
        { label: 'RAM %',     width: 55  },
        { label: 'VMs',       width: 50  },
        { label: 'LXC',       width: 50  },
      ];
      tableHeader(pCols);
      d.proxmox.nodes.forEach((n, i) => tableRow(pCols, [
        n.node, n.status,
        n.maxcpu,
        `${n.cpu_usage}%`,
        `${n.mem_used_gb} / ${n.maxmem_gb}`,
        `${n.mem_usage}%`,
        `${n.vm_running}/${n.vm_count}`,
        `${n.lxc_running}/${n.lxc_count}`,
      ], i % 2 === 1));

      // Totals
      const totalCPU  = d.proxmox.nodes.reduce((a, n) => a + (n.maxcpu || 0), 0);
      const totalRAM  = d.proxmox.nodes.reduce((a, n) => a + parseFloat(n.maxmem_gb || 0), 0);
      const totalVMs  = d.proxmox.nodes.reduce((a, n) => a + n.vm_count, 0);
      const totalLXC  = d.proxmox.nodes.reduce((a, n) => a + n.lxc_count, 0);
      const runningVMs  = d.proxmox.nodes.reduce((a, n) => a + n.vm_running, 0);
      const runningLXC  = d.proxmox.nodes.reduce((a, n) => a + n.lxc_running, 0);
      doc.moveDown(0.5);
      row('Total nodes',   d.proxmox.nodes.length);
      row('Total CPU cores', totalCPU);
      row('Total RAM',      `${totalRAM.toFixed(1)} GB`);
      row('Total VMs',      `${runningVMs} running / ${totalVMs} total`);
      row('Total LXC',      `${runningLXC} running / ${totalLXC} total`);
    }

    // ── Entra ID ─────────────────────────────────────────────────────────────
    doc.addPage();
    section('ENTRA ID APP REGISTRATIONS');
    row('Total apps', d.entra.total);
    row('Secrets expiring in 30 days', d.entra.expiring_30, d.entra.expiring_30 > 0 ? RED : 'black');
    doc.moveDown(0.5);

    const eCols = [
      { label: 'App name',      width: 200 },
      { label: 'Client ID',     width: 160 },
      { label: 'Secret expiry', width: 90, color: v => { const d = v ? Math.ceil((new Date(v) - new Date()) / 86400000) : null; return d != null && d <= 30 ? RED : 'black'; } },
    ];
    tableHeader(eCols);
    d.entra.list.forEach((a, i) => tableRow(eCols, [a.app_name, a.client_id?.substring(0, 30) || '—', a.secret_expiry || '—'], i % 2 === 1));

    // ── M365 Mail Flow ───────────────────────────────────────────────────────
    if (d.mailFlow?.domains?.length) {
      doc.addPage();
      section('MICROSOFT 365 MAIL FLOW');
      row('Total sent',     d.mailFlow.totals.send.toLocaleString());
      row('Total received', d.mailFlow.totals.receive.toLocaleString());
      row('Total read',     d.mailFlow.totals.read.toLocaleString());
      doc.moveDown(0.3);
      const mfCols = [
        { label: 'Domain',   width: 200 },
        { label: 'Sent',     width: 100 },
        { label: 'Received', width: 100 },
        { label: 'Read',     width: 100 },
      ];
      tableHeader(mfCols);
      d.mailFlow.domains.forEach((dm, i) => tableRow(mfCols, [
        `@${dm.domain}`,
        dm.send.toLocaleString(),
        dm.receive.toLocaleString(),
        dm.read.toLocaleString(),
      ], i % 2 === 1));
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    doc.addPage();
    section(`NOTIFICATIONS (last ${period} days)`);
    row('Total', d.notifications.total);
    row('Errors',   d.notifications.by_type.error   || 0, d.notifications.by_type.error   > 0 ? RED    : 'black');
    row('Warnings', d.notifications.by_type.warning || 0, d.notifications.by_type.warning > 0 ? ORANGE : 'black');
    row('Success',  d.notifications.by_type.success || 0, GREEN);
    doc.moveDown(0.3);

    if (d.notifications.recent.length) {
      doc.moveDown(0.3);
      const nCols = [
        { label: 'Type',    width: 60, color: v => ({ error: RED, warning: ORANGE, success: GREEN, info: BLUE }[v] || GRAY) },
        { label: 'Module',  width: 80 },
        { label: 'Title',   width: 230 },
        { label: 'Time',    width: 130 },
      ];
      tableHeader(nCols);
      d.notifications.recent.forEach((n, i) => tableRow(nCols, [
        n.type, n.module, n.title,
        new Date(n.created_at + 'Z').toLocaleString('en'),
      ], i % 2 === 1));
    }

    // ── Footer on last page only ──────────────────────────────────────────────
    const appName2 = appName;
    doc.fillColor('#6B7280').fontSize(8)
      .text(`${appName2} · Infrastructure Report · Generated ${new Date().toLocaleString('en')}`,
        50, doc.page.height - 35, { width: pageW, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[Reports] PDF error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
