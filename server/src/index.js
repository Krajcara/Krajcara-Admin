require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const path       = require('path');
const { Server } = require('socket.io');
const rateLimit  = require('express-rate-limit');

const db         = require('./db/database');
const { requireAuth } = require('./middleware/auth');
const { autoAuditMiddleware } = require('./middleware/audit');
const scheduler  = require('./scheduler');

const authRoutes    = require('./routes/auth');
const totpRoutes    = require('./routes/totp');
const usersRoutes   = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const auditRoutes   = require('./routes/audit');
const apiKeyRoutes  = require('./routes/api-keys');
const statusRoutes   = require('./routes/status');
const licencesRoutes = require('./routes/licences');
const updateRoutes   = require('./routes/update');
const monitorsRoutes = require('./routes/monitors');
const routersRoutes  = require('./routes/routers');
const dnsRoutes      = require('./routes/dns');
const proxmoxRoutes  = require('./routes/proxmox');
const { router: scannerRouter, initSchedules } = require('./routes/scanner');
const netspeedRoutes = require('./routes/netspeed');
const m365Routes     = require('./routes/m365');
const { router: backupRouter, runAutoBackup } = require('./routes/backup');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : '*',
    credentials: true
  }
});
app.set('io', io);

// ── Security & middleware ─────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : false,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short'));

const apiLimiter  = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60000, max: 15,  standardHeaders: true, legacyHeaders: false });

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/', autoAuditMiddleware);

// ── Public routes ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() }));
app.use('/api/auth',        authRoutes);
app.use('/api/totp',        totpRoutes);
app.get('/api/settings/app', settingsRoutes);
app.use('/api/status',      statusRoutes);
// Public endpoints — no auth
app.get('/api/monitors/public', (req, res) => {
  const db = require('./db/database');
  const monitors = db.prepare(
    'SELECT id, label, type, target, last_status, last_latency_ms, last_checked_at FROM monitors WHERE enabled = 1 ORDER BY label'
  ).all();
  res.json(monitors);
});
// Public monitor checks — for sparkline on status page
app.get('/api/monitors/:id/checks/public', (req, res) => {
  const db    = require('./db/database');
  const hours = parseInt(req.query.hours) || 3;
  const since = new Date(Date.now() - hours * 3600 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);
  const checks = db.prepare(
    'SELECT latency_ms, checked_at FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC LIMIT 500'
  ).all(req.params.id, since);
  res.json(checks);
});
// Public M365 service health — no auth
app.get('/api/m365/health/public', async (req, res) => {
  try {
    const db  = require('./db/database');
    const tid = db.prepare("SELECT value FROM settings WHERE key='m365_tenant_id'").get()?.value;
    const cid = db.prepare("SELECT value FROM settings WHERE key='m365_client_id'").get()?.value;
    const sec = db.prepare("SELECT value FROM settings WHERE key='m365_client_secret'").get()?.value;
    if (!tid || !cid || !sec) return res.json({ configured: false });
    const axios = require('axios');
    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
      new URLSearchParams({ grant_type: 'client_credentials', client_id: cid, client_secret: sec, scope: 'https://graph.microsoft.com/.default' }),
      { timeout: 15000 }
    );
    const token = tokenRes.data.access_token;
    const data  = await axios.get('https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews?$expand=issues', {
      headers: { Authorization: `Bearer ${token}` }, timeout: 15000
    });
    res.json({
      configured: true,
      services: (data.data.value || []).map(s => ({
        service:       s.service,
        status:        s.status,
        active_issues: (s.issues || []).filter(i => i.status !== 'resolved').length,
        issues:        (s.issues || []).filter(i => i.status !== 'resolved').slice(0, 3).map(i => ({
          title:             i.title,
          impactDescription: i.impactDescription?.slice(0, 120),
        })),
      }))
    });
  } catch (err) {
    res.json({ configured: false, error: err.message });
  }
});
// Public DNS endpoint
app.get('/api/dns/public', async (req, res) => {
  try {
  const db  = require('./db/database');
  // Local DNS servers
  const localServers = db.prepare('SELECT id, role, type, ip, label FROM dns_local ORDER BY role').all();
  const localResults = await Promise.all(localServers.map(async s => {
    try {
      const axios   = require('axios');
      const dnsLib  = require('dns').promises;
      const baseUrl = s.ip.startsWith('http') ? s.ip.replace(/\/$/, '') : `http://${s.ip}`;
      const dnsIp   = s.ip.replace(/^https?:\/\//, '').split(':')[0];
      // Quick reachability check
      let online = false;
      try {
        const resolver = new dnsLib.Resolver();
        resolver.setServers([dnsIp]);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 2000);
          resolver.resolve4('cloudflare.com', (err) => { clearTimeout(t); err ? reject(err) : resolve(); });
        });
        online = true;
      } catch {}
      return { id: s.id, role: s.role, type: s.type, ip: s.ip, label: s.label, online };
    } catch { return { id: s.id, role: s.role, type: s.type, ip: s.ip, label: s.label, online: false }; }
  }));
  // External domains — just check if they resolve
  const domains = db.prepare('SELECT domain FROM dns_domains').all().map(r => r.domain);
  const dnsLib  = require('dns').promises;
  const domainResults = await Promise.all(domains.slice(0, 10).map(async domain => {
    try {
      const ips = await dnsLib.resolve4(domain);
      return { domain, online: ips.length > 0 };
    } catch { return { domain, online: false }; }
  }));
  res.json({ local: localResults, domains: domainResults });
  } catch (err) { res.json({ local: [], domains: [], error: err.message }); }
});
app.get('/api/netspeed/public', (req, res) => {
  const db = require('./db/database');
  const tests = db.prepare(
    "SELECT download, upload, ping, created_at FROM speed_tests WHERE status='done' ORDER BY created_at DESC LIMIT 50"
  ).all();
  const calc = (vals) => {
    const v = vals.filter(x => x != null && x > 0);
    if (!v.length) return { min: null, avg: null, max: null };
    return {
      min: Math.round(Math.min(...v) * 10) / 10,
      avg: Math.round((v.reduce((a,b) => a+b,0) / v.length) * 10) / 10,
      max: Math.round(Math.max(...v) * 10) / 10,
    };
  };
  res.json({
    stats: {
      download: calc(tests.map(t => t.download)),
      upload:   calc(tests.map(t => t.upload)),
      ping:     calc(tests.map(t => t.ping)),
    },
    tests,
  });
});
app.get('/api/routers/public', (req, res) => {
  const db = require('./db/database');
  const routers = db.prepare('SELECT id, name, brand, model, ip_address FROM routers ORDER BY name').all();
  res.json(routers);
});
app.get('/api/routers/:id/ping/public', async (req, res) => {
  const db = require('./db/database');
  const r = db.prepare('SELECT ip_address FROM routers WHERE id = ?').get(req.params.id);
  if (!r) return res.json({ alive: false });
  try {
    const { execSync } = require('child_process');
    const start = Date.now();
    execSync(`ping -c 1 -W 3 ${r.ip_address}`, { timeout: 5000 });
    res.json({ alive: true, latency_ms: Date.now() - start });
  } catch {
    res.json({ alive: false });
  }
});
app.get('/api/proxmox/public', async (req, res) => {
  try {
    const proxmoxRoute = require('./routes/proxmox');
    // Reuse same logic but without auth
    const axios = require('axios');
    const https = require('https');
    const db    = require('./db/database');
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const url     = db.prepare("SELECT value FROM settings WHERE key='proxmox_url'").get()?.value;
    const tokenId = db.prepare("SELECT value FROM settings WHERE key='proxmox_token_id'").get()?.value || '';
    const user    = db.prepare("SELECT value FROM settings WHERE key='proxmox_user'").get()?.value || 'root@pam';
    const secret  = db.prepare("SELECT value FROM settings WHERE key='proxmox_api_token'").get()?.value || '';
    if (!url || !secret) return res.json({ configured: false });
    const token = tokenId ? `${user}!${tokenId}=${secret}` : secret;
    const r = await axios.get(`${url}/api2/json/nodes`, {
      headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 10000
    });
    const nodes = (r.data.data || []).map(n => ({
      node:         n.node,
      status:       n.status,
      cpu_usage:    n.cpu  != null  ? Math.round(n.cpu  * 100) : 0,
      mem_usage:    n.mem  && n.maxmem  ? Math.round((n.mem  / n.maxmem)  * 100) : 0,
      disk_usage:   n.disk && n.maxdisk ? Math.round((n.disk / n.maxdisk) * 100) : 0,
      mem_used_gb:  n.mem    ? (n.mem    / 1073741824).toFixed(1) : '0',
      mem_max_gb:   n.maxmem ? (n.maxmem / 1073741824).toFixed(1) : '0',
      maxcpu:       n.maxcpu,
      uptime:       n.uptime,
    })).sort((a, b) => a.node.localeCompare(b.node));
    // Get VM counts per node
    for (const node of nodes) {
      if (node.status !== 'online') { node.vm_count = 0; node.running = 0; continue; }
      try {
        const [vms, lxc] = await Promise.all([
          axios.get(`${url}/api2/json/nodes/${node.node}/qemu`, { headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 8000 }),
          axios.get(`${url}/api2/json/nodes/${node.node}/lxc`,  { headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 8000 }),
        ]);
        const all = [...(vms.data.data || []), ...(lxc.data.data || [])];
        node.vm_count = all.length;
        node.running  = all.filter(v => v.status === 'running').length;
        // Storage
        const stor = await axios.get(`${url}/api2/json/nodes/${node.node}/storage`, { headers: { Authorization: `PVEAPIToken=${token}` }, httpsAgent, timeout: 8000 });
        node.storages = (stor.data.data || []).map(s => ({
          storage:   s.storage,
          type:      s.type,
          total_gb:  s.total ? (s.total / 1073741824).toFixed(1) : null,
          used_gb:   s.used  ? (s.used  / 1073741824).toFixed(1) : null,
          usage_pct: s.total && s.used ? Math.round((s.used / s.total) * 100) : null,
        }));
      } catch { node.vm_count = 0; node.running = 0; node.storages = []; }
    }
    res.json({ configured: true, nodes });
  } catch (err) {
    res.json({ configured: false, error: err.message });
  }
});

// ── Protected routes ──────────────────────────────────────────────
app.use('/api/users',       requireAuth, usersRoutes);
app.use('/api/settings',    requireAuth, settingsRoutes);
app.use('/api/audit',       requireAuth, auditRoutes);
app.use('/api/api-keys',    requireAuth, apiKeyRoutes);
app.use('/api/licences',    requireAuth, licencesRoutes);
app.use('/api/update',      requireAuth, updateRoutes);
app.use('/api/monitors',    requireAuth, monitorsRoutes);
app.use('/api/routers',     requireAuth, routersRoutes);
app.use('/api/dns',         requireAuth, dnsRoutes);
app.use('/api/proxmox',     requireAuth, proxmoxRoutes);
app.use('/api/scanner',     requireAuth, scannerRouter);
app.use('/api/netspeed',    requireAuth, netspeedRoutes.router);
app.use('/api/m365',       requireAuth, m365Routes);
app.use('/api/backup',     requireAuth, backupRouter);

// ── Socket.io ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});
global.io = io; // Make accessible to routes (update, monitorWorker);

// ── Frontend SPA (production) ─────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../../client/dist');
  app.use(express.static(dist));
  // Catch-all: serve index.html for any non-API route (React Router handles it)
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ── Error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────
const PORT = parseInt(process.env.APP_PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Krajcara Admin v1.0.0 started on port ${PORT}`);
  scheduler.start();
});

module.exports = { app, server };
