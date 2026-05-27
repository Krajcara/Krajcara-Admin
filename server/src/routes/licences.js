const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────
const clean = s => typeof s === 'string' ? s.replace(/\0/g, '').trim() : s;

function calcTotals(licences) {
  const paid = {}, free = {};
  licences.filter(l => !l.hidden).forEach(l => {
    const price = l.price_per_licence || 0;
    if (!price) return;
    const count = l.is_free
      ? (l.active_users != null ? l.active_users : (l.assigned_to?.length || 0))
      : (l.licence_count || 1);
    const total = price * count * (1 + (l.tax_percent || 0) / 100);
    const cur   = (l.currency || 'EUR').toUpperCase();
    const bucket = l.is_free ? free : paid;
    if (!bucket[cur]) bucket[cur] = { monthly: 0, annual: 0, currency: cur };
    if (l.billing_cycle === 'monthly')      { bucket[cur].monthly += total; bucket[cur].annual += total * 12; }
    else if (l.billing_cycle === 'annual')  { bucket[cur].annual  += total; bucket[cur].monthly += total / 12; }
  });
  const round = v => Math.round(v * 100) / 100;
  [paid, free].forEach(b => Object.values(b).forEach(x => { x.monthly = round(x.monthly); x.annual = round(x.annual); }));
  return { paid, free };
}

function mapLicence(l) {
  return {
    ...l,
    vendor:       clean(l.vendor),
    licence_type: clean(l.licence_type),
    assigned_to:  l.assigned_to  ? JSON.parse(l.assigned_to)  : [],
  };
}

function mapEntraApp(app) {
  const days = app.secret_expiry
    ? Math.ceil((new Date(app.secret_expiry) - new Date()) / 86400000)
    : null;
  return {
    ...app,
    client_secret:    app.client_secret ? '***' : null,
    days_until_expiry: days,
    secret_status: days == null ? null : days < 0 ? 'expired' : days < 30 ? 'expiring' : 'ok',
  };
}

// ── LICENCES ──────────────────────────────────────────────────────────────────

// GET /api/licences
router.get('/', (req, res) => {
  const showHidden = req.query.show_hidden === 'true';
  let q = 'SELECT * FROM licences';
  if (!showHidden) q += ' WHERE hidden = 0';
  q += ' ORDER BY vendor, licence_type';
  const licences = db.prepare(q).all().map(mapLicence);
  res.json({ licences, totals: calcTotals(licences) });
});

// POST /api/licences
router.post('/', (req, res) => {
  const {
    vendor, licence_type, licence_count, licence_used,
    purchase_date, expiry_date, price_per_licence, currency,
    billing_cycle, tax_percent, is_free, active_users,
    assigned_to, url, licence_username, licence_password, licence_mfa, notes
  } = req.body;

  const v = clean(vendor), t = clean(licence_type);
  if (!v || !t) return res.status(400).json({ error: 'vendor and licence_type are required' });

  const assigned = Array.isArray(assigned_to) ? assigned_to : [];
  const used     = assigned.length > 0 ? assigned.length : (parseInt(licence_used) || 0);

  const r = db.prepare(`
    INSERT INTO licences
      (vendor, licence_type, licence_count, licence_used, purchase_date, expiry_date,
       price_per_licence, currency, billing_cycle, tax_percent, is_free, active_users,
       assigned_to, url, licence_username, licence_password, licence_mfa, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(v, t, parseInt(licence_count) || 1, used,
    purchase_date || null, expiry_date || null,
    price_per_licence ? parseFloat(price_per_licence) : null,
    currency || 'EUR', billing_cycle || 'annual',
    parseFloat(tax_percent) || 0, is_free ? 1 : 0,
    active_users != null && active_users !== '' ? parseInt(active_users) : null,
    JSON.stringify(assigned),
    url || null, licence_username || null, licence_password || null,
    licence_mfa ? 1 : 0, notes || null
  );

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'licences', entityId: r.lastInsertRowid, entityName: `${v} — ${t}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ id: r.lastInsertRowid });
});

// PUT /api/licences/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM licences WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    vendor, licence_type, licence_count, licence_used,
    purchase_date, expiry_date, price_per_licence, currency,
    billing_cycle, tax_percent, is_free, active_users,
    assigned_to, url, licence_username, licence_password, licence_mfa, notes
  } = req.body;

  const v = clean(vendor) || existing.vendor;
  const t = clean(licence_type) || existing.licence_type;
  const assigned = Array.isArray(assigned_to) ? assigned_to : JSON.parse(existing.assigned_to || '[]');
  const used     = assigned.length > 0 ? assigned.length : (parseInt(licence_used) || 0);

  // Only update password if a real new value was provided (not blank, not placeholder)
  const newPass = licence_password && licence_password !== '***' && licence_password !== ''
    ? licence_password
    : existing.licence_password;

  db.prepare(`
    UPDATE licences SET
      vendor=?, licence_type=?, licence_count=?, licence_used=?,
      purchase_date=?, expiry_date=?, price_per_licence=?, currency=?,
      billing_cycle=?, tax_percent=?, is_free=?, active_users=?,
      assigned_to=?, url=?, licence_username=?, licence_password=?,
      licence_mfa=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(v, t, parseInt(licence_count) || existing.licence_count, used,
    purchase_date || null, expiry_date || null,
    price_per_licence != null && price_per_licence !== '' ? parseFloat(price_per_licence) : existing.price_per_licence,
    currency || existing.currency, billing_cycle || existing.billing_cycle,
    parseFloat(tax_percent) || 0,
    is_free !== undefined ? (is_free ? 1 : 0) : existing.is_free,
    active_users != null && active_users !== '' ? parseInt(active_users) : existing.active_users,
    JSON.stringify(assigned),
    url !== undefined ? (url || null) : existing.url,
    licence_username !== undefined ? (licence_username || null) : existing.licence_username,
    newPass,
    licence_mfa !== undefined ? (licence_mfa ? 1 : 0) : existing.licence_mfa,
    notes !== undefined ? (notes || null) : existing.notes,
    req.params.id
  );

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'licences', entityId: req.params.id, entityName: `${v} — ${t}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// DELETE /api/licences/:id
router.delete('/:id', (req, res) => {
  const l = db.prepare('SELECT vendor, licence_type FROM licences WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM licences WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'licences', entityId: req.params.id, entityName: `${l.vendor} — ${l.licence_type}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// POST /api/licences/:id/renew
router.post('/:id/renew', (req, res) => {
  const l = db.prepare('SELECT * FROM licences WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });

  let newExpiry;
  if (req.body.expiry_date) {
    // Use explicitly provided date from confirmation modal
    newExpiry = req.body.expiry_date;
  } else {
    // Fallback: auto-calculate from billing cycle
    const cycle = req.body.cycle || l.billing_cycle || 'annual';
    const base  = (l.expiry_date && new Date(l.expiry_date) > new Date()) ? new Date(l.expiry_date) : new Date();
    if (cycle === 'monthly') base.setMonth(base.getMonth() + 1);
    else base.setFullYear(base.getFullYear() + 1);
    newExpiry = base.toISOString().split('T')[0];
  }

  db.prepare("UPDATE licences SET expiry_date=?, updated_at=datetime('now') WHERE id=?").run(newExpiry, req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'licences', entityId: req.params.id, entityName: `${l.vendor} — ${l.licence_type} (renewed to ${newExpiry})`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true, expiry_date: newExpiry });
});

// POST /api/licences/:id/toggle-hidden
router.post('/:id/toggle-hidden', (req, res) => {
  const l = db.prepare('SELECT hidden FROM licences WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE licences SET hidden=? WHERE id=?').run(l.hidden ? 0 : 1, req.params.id);
  res.json({ ok: true, hidden: !l.hidden });
});

// ── ENTRA ID APPS ─────────────────────────────────────────────────────────────

// GET /api/licences/entra-apps
router.get('/entra-apps', (req, res) => {
  const showHidden = req.query.show_hidden === 'true';
  let q = 'SELECT * FROM entra_apps';
  if (!showHidden) q += ' WHERE hidden = 0';
  q += ' ORDER BY app_name';
  res.json(db.prepare(q).all().map(mapEntraApp));
});

// POST /api/licences/entra-apps
router.post('/entra-apps', (req, res) => {
  const { app_name, app_id, client_secret, secret_expiry, assigned_to, project, notes } = req.body;
  if (!app_name?.trim()) return res.status(400).json({ error: 'app_name is required' });
  const r = db.prepare(`
    INSERT INTO entra_apps (app_name, app_id, client_secret, secret_expiry, assigned_to, project, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(app_name.trim(), app_id || null, client_secret || null, secret_expiry || null, assigned_to || null, project || null, notes || null);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'licences', entityId: r.lastInsertRowid, entityName: `Entra: ${app_name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ id: r.lastInsertRowid, ok: true });
});

// PUT /api/licences/entra-apps/:id
router.put('/entra-apps/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM entra_apps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { app_name, app_id, client_secret, secret_expiry, assigned_to, project, notes } = req.body;
  if (!app_name?.trim()) return res.status(400).json({ error: 'app_name is required' });
  // Keep existing secret if new one is blank or placeholder
  const newSecret = (client_secret && client_secret !== '***' && client_secret !== '')
    ? client_secret
    : existing.client_secret;
  db.prepare(`
    UPDATE entra_apps SET app_name=?, app_id=?, client_secret=?, secret_expiry=?,
      assigned_to=?, project=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(app_name.trim(), app_id || null, newSecret, secret_expiry || null, assigned_to || null, project || null, notes || null, req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'licences', entityId: req.params.id, entityName: `Entra: ${app_name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// DELETE /api/licences/entra-apps/:id
router.delete('/entra-apps/:id', (req, res) => {
  const a = db.prepare('SELECT app_name FROM entra_apps WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM entra_apps WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'licences', entityId: req.params.id, entityName: `Entra: ${a.app_name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// POST /api/licences/entra-apps/:id/reveal — returns actual secret value
router.post('/entra-apps/:id/reveal', (req, res) => {
  const a = db.prepare('SELECT client_secret FROM entra_apps WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'licences', entityId: req.params.id, entityName: 'Entra secret revealed', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ secret: a.client_secret });
});

// POST /api/licences/entra-apps/:id/toggle-hidden
router.post('/entra-apps/:id/toggle-hidden', (req, res) => {
  const a = db.prepare('SELECT hidden FROM entra_apps WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE entra_apps SET hidden=? WHERE id=?').run(a.hidden ? 0 : 1, req.params.id);
  res.json({ ok: true, hidden: !a.hidden });
});

module.exports = router;
