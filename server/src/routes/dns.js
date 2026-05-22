const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const dnsLib  = require('dns').promises;
const axios   = require('axios');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

const DNS_TYPES = {
  technitium:  'Technitium DNS',
  pihole:      'Pi-hole',
  adguard:     'AdGuard Home',
  bind9:       'BIND9',
  windows_dns: 'Windows Server DNS',
  other:       'DNS Server',
};

// ── Local DNS servers CRUD ────────────────────────────────────────────────────

// GET /api/dns/local
router.get('/local', (req, res) => {
  const servers = db.prepare('SELECT id, role, type, ip, label, created_at FROM dns_local ORDER BY role ASC').all();
  res.json(servers);
});

// POST /api/dns/local
router.post('/local', requireRole('superadmin', 'admin'), (req, res) => {
  const { role, type, ip, api_key, label } = req.body;
  if (!ip?.trim()) return res.status(400).json({ error: 'IP is required' });
  if (!['primary', 'backup'].includes(role)) return res.status(400).json({ error: 'Role must be primary or backup' });

  // Only one per role
  const existing = db.prepare('SELECT id FROM dns_local WHERE role = ?').get(role);
  if (existing) {
    db.prepare('UPDATE dns_local SET type=?, ip=?, api_key=?, label=?, updated_at=datetime(\'now\') WHERE role=?')
      .run(type || 'other', ip.trim(), api_key || null, label || null, role);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'dns', entityName: `Local DNS ${role}`, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ ok: true, id: existing.id });
  }

  const r = db.prepare('INSERT INTO dns_local (role, type, ip, api_key, label) VALUES (?,?,?,?,?)')
    .run(role, type || 'other', ip.trim(), api_key || null, label || null);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'dns', entityName: `Local DNS ${role}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true, id: r.lastInsertRowid });
});

// DELETE /api/dns/local/:id
router.delete('/local/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM dns_local WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'dns', entityId: req.params.id, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// GET /api/dns/local/:id/status — check if a local DNS server is reachable
router.get('/local/:id/status', async (req, res) => {
  const server = db.prepare('SELECT * FROM dns_local WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });

  const { type, ip, api_key } = server;
  const baseUrl = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
  const dnsIp   = ip.replace(/^https?:\/\//, '').split(':')[0];
  const typeLabel = DNS_TYPES[type] || type;

  const fallbackRawDns = async () => {
    try {
      const resolver = new dnsLib.Resolver();
      resolver.setServers([dnsIp]);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 3000);
        resolver.resolve4('cloudflare.com', (err) => { clearTimeout(t); err ? reject(err) : resolve(); });
      });
      return { online: true };
    } catch (e) {
      return { online: false, error: e.message };
    }
  };

  try {
    if (type === 'pihole') {
      // Pi-hole v6
      try {
        const r = await axios.post(`${baseUrl}/api/auth`, { password: api_key || '' }, { timeout: 5000 });
        if (r.status === 200) return res.json({ online: true, type_label: typeLabel, version: 6 });
      } catch {}
      // Pi-hole v5
      try {
        const r = await axios.get(`${baseUrl}/admin/api.php?status&auth=${api_key || ''}`, { timeout: 5000 });
        if (r.data?.status) return res.json({ online: true, type_label: typeLabel, version: 5 });
      } catch {}
      const raw = await fallbackRawDns();
      return res.json({ ...raw, type_label: typeLabel });
    }

    if (type === 'technitium' && api_key) {
      try {
        const r = await axios.get(`${baseUrl}/api/user/session/get?token=${api_key}`, { timeout: 5000 });
        if (r.data?.status === 'ok' || r.status === 200) {
          // Also get stats
          try {
            const s = await axios.get(`${baseUrl}/api/dashboard/stats/get?token=${api_key}&type=LastHour`, { timeout: 5000 });
            const stats = s.data?.response?.stats;
            return res.json({
              online: true, type_label: typeLabel,
              stats: stats ? {
                totalQueries: stats.totalQueries || 0,
                totalBlocked: stats.totalBlocked || 0,
                totalClients: stats.totalClients || 0,
              } : null
            });
          } catch {}
          return res.json({ online: true, type_label: typeLabel });
        }
      } catch {}
    }

    if (type === 'adguard') {
      try {
        const r = await axios.get(`${baseUrl}/control/status`, { timeout: 5000 });
        if (r.status === 200) return res.json({ online: true, type_label: typeLabel, running: r.data?.running });
      } catch {}
    }

    // Fallback: raw DNS
    const raw = await fallbackRawDns();
    return res.json({ ...raw, type_label: typeLabel });
  } catch (err) {
    res.json({ online: false, type_label: typeLabel, error: err.message });
  }
});

// ── External DNS domains ──────────────────────────────────────────────────────

// GET /api/dns/domains
router.get('/domains', (req, res) => {
  res.json(db.prepare('SELECT * FROM dns_domains ORDER BY domain').all());
});

// POST /api/dns/domains
router.post('/domains', requireRole('superadmin', 'admin'), (req, res) => {
  const { domain, notes } = req.body;
  if (!domain?.trim()) return res.status(400).json({ error: 'Domain is required' });
  try {
    const r = db.prepare('INSERT OR IGNORE INTO dns_domains (domain, notes) VALUES (?, ?)')
      .run(domain.trim().toLowerCase(), notes || null);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'dns', entityId: r.lastInsertRowid, entityName: domain, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/dns/domains/:id
router.delete('/domains/:id', requireRole('superadmin', 'admin'), (req, res) => {
  db.prepare('DELETE FROM dns_domains WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Domain check ─────────────────────────────────────────────────────────────

async function checkDomain(domain) {
  const result = { domain, spf: null, dkim: null, dmarc: null, mx: [], a: [], ns: [], checked_at: new Date().toISOString() };
  try {
    const [mx, a, txt, ns, dmarc] = await Promise.allSettled([
      dnsLib.resolveMx(domain),
      dnsLib.resolve4(domain),
      dnsLib.resolveTxt(domain),
      dnsLib.resolveNs(domain),
      dnsLib.resolveTxt(`_dmarc.${domain}`),
    ]);
    result.mx   = mx.status   === 'fulfilled' ? mx.value.sort((a, b) => a.priority - b.priority)  : [];
    result.a    = a.status    === 'fulfilled' ? a.value   : [];
    result.ns   = ns.status   === 'fulfilled' ? ns.value  : [];
    const txts  = txt.status  === 'fulfilled' ? txt.value.map(t => t.join('')) : [];
    result.spf  = txts.find(t => t.startsWith('v=spf1')) || null;
    result.dmarc = dmarc.status === 'fulfilled'
      ? dmarc.value.flat().find(t => t.startsWith('v=DMARC1')) || null
      : null;
    // DKIM — try common selectors
    for (const sel of ['default', 'selector1', 'selector2', 'google', 'k1', 'dkim', 'mail']) {
      try {
        const d = await dnsLib.resolveTxt(`${sel}._domainkey.${domain}`);
        const val = d.flat().join('');
        if (val.includes('v=DKIM1')) { result.dkim = { selector: sel, value: val }; break; }
      } catch {}
    }
    result.status = 'ok';
  } catch (e) {
    result.status = 'error';
    result.error  = e.message;
  }
  return result;
}

// POST /api/dns/check — check single domain
router.post('/check', async (req, res) => {
  const { domain } = req.body;
  if (!domain?.trim()) return res.status(400).json({ error: 'Domain is required' });
  res.json(await checkDomain(domain.trim().toLowerCase()));
});

// GET /api/dns/check-all — check all monitored domains
router.get('/check-all', async (req, res) => {
  const domains = db.prepare('SELECT domain FROM dns_domains').all().map(r => r.domain);
  if (domains.length === 0) return res.json([]);
  const results = await Promise.all(domains.map(checkDomain));
  res.json(results);
});

module.exports = router;
