'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

// ── VLANs ─────────────────────────────────────────────────────────────────────

router.get('/vlans', (req, res) => {
  const vlans = db.prepare(`
    SELECT v.*, r.name as router_name,
      (SELECT COUNT(*) FROM ip_addresses WHERE vlan_id = v.id) as ip_count
    FROM vlans v
    LEFT JOIN routers r ON v.router_id = r.id
    ORDER BY v.vlan_id
  `).all();
  res.json(vlans);
});

router.post('/vlans', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { vlan_id, name, description, subnet, gateway, dhcp_start, dhcp_end, purpose, color, router_id } = req.body;
  if (!vlan_id || !name?.trim()) return res.status(400).json({ error: 'vlan_id and name are required' });
  if (vlan_id < 1 || vlan_id > 4094) return res.status(400).json({ error: 'VLAN ID must be between 1 and 4094' });
  try {
    const r = db.prepare(`
      INSERT INTO vlans (vlan_id, name, description, subnet, gateway, dhcp_start, dhcp_end, purpose, color, router_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(parseInt(vlan_id), name.trim(), description||null, subnet||null, gateway||null,
      dhcp_start||null, dhcp_end||null, purpose||'production', color||'#6366f1',
      router_id ? parseInt(router_id) : null);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'ipspace', entityId: r.lastInsertRowid, entityName: `VLAN ${vlan_id} — ${name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: `VLAN ID ${vlan_id} already exists` });
    res.status(500).json({ error: e.message });
  }
});

router.put('/vlans/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM vlans WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, description, subnet, gateway, dhcp_start, dhcp_end, purpose, color, router_id } = req.body;
  db.prepare(`
    UPDATE vlans SET name=?, description=?, subnet=?, gateway=?, dhcp_start=?, dhcp_end=?,
      purpose=?, color=?, router_id=?, updated_at=datetime('now') WHERE id=?
  `).run(
    name ?? existing.name, description ?? existing.description,
    subnet ?? existing.subnet, gateway ?? existing.gateway,
    dhcp_start ?? existing.dhcp_start, dhcp_end ?? existing.dhcp_end,
    purpose ?? existing.purpose, color ?? existing.color,
    router_id !== undefined ? (router_id ? parseInt(router_id) : null) : existing.router_id,
    req.params.id
  );
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'ipspace', entityId: req.params.id, entityName: `VLAN ${existing.vlan_id}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

router.delete('/vlans/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const v = db.prepare('SELECT vlan_id, name FROM vlans WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  // Unlink IPs from this VLAN instead of deleting them
  db.prepare('UPDATE ip_addresses SET vlan_id = NULL WHERE vlan_id = ?').run(req.params.id);
  db.prepare('DELETE FROM vlans WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'ipspace', entityId: req.params.id, entityName: `VLAN ${v.vlan_id} — ${v.name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// ── IP Addresses ──────────────────────────────────────────────────────────────

router.get('/ips', (req, res) => {
  const { vlan_id, search } = req.query;
  let q = `
    SELECT i.*, v.name as vlan_name, v.vlan_id as vlan_number, v.color as vlan_color
    FROM ip_addresses i
    LEFT JOIN vlans v ON i.vlan_id = v.id
    WHERE 1=1
  `;
  const params = [];
  if (vlan_id) { q += ' AND i.vlan_id = ?'; params.push(parseInt(vlan_id)); }
  if (search)  { q += ' AND (i.ip_address LIKE ? OR i.hostname LIKE ? OR i.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  q += ' ORDER BY i.ip_address';
  res.json(db.prepare(q).all(...params));
});

router.post('/ips', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { ip_address, hostname, mac_address, vlan_id, purpose, description } = req.body;
  if (!ip_address?.trim()) return res.status(400).json({ error: 'ip_address is required' });
  try {
    const r = db.prepare(`
      INSERT INTO ip_addresses (ip_address, hostname, mac_address, vlan_id, purpose, description)
      VALUES (?,?,?,?,?,?)
    `).run(ip_address.trim(), hostname||null, mac_address||null,
      vlan_id ? parseInt(vlan_id) : null, purpose||'other', description||null);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'ipspace', entityId: r.lastInsertRowid, entityName: ip_address, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: `IP address ${ip_address} already exists` });
    res.status(500).json({ error: e.message });
  }
});

router.put('/ips/:id', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM ip_addresses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { hostname, mac_address, vlan_id, purpose, description } = req.body;
  db.prepare(`
    UPDATE ip_addresses SET hostname=?, mac_address=?, vlan_id=?, purpose=?, description=?, updated_at=datetime('now') WHERE id=?
  `).run(
    hostname    !== undefined ? (hostname    || null) : existing.hostname,
    mac_address !== undefined ? (mac_address || null) : existing.mac_address,
    vlan_id     !== undefined ? (vlan_id ? parseInt(vlan_id) : null) : existing.vlan_id,
    purpose     ?? existing.purpose,
    description !== undefined ? (description || null) : existing.description,
    req.params.id
  );
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'ipspace', entityId: req.params.id, entityName: existing.ip_address, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

router.delete('/ips/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const ip = db.prepare('SELECT ip_address FROM ip_addresses WHERE id = ?').get(req.params.id);
  if (!ip) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM ip_addresses WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'ipspace', entityId: req.params.id, entityName: ip.ip_address, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// POST /api/ipspace/ips/ping/:id — ping single IP
router.post('/ips/ping/:id', async (req, res) => {
  const ip = db.prepare('SELECT * FROM ip_addresses WHERE id = ?').get(req.params.id);
  if (!ip) return res.status(404).json({ error: 'Not found' });
  try {
    const { execSync } = require('child_process');
    const start = Date.now();
    execSync(`ping -c 1 -W 2 ${ip.ip_address}`, { timeout: 5000 });
    const latency = Date.now() - start;
    db.prepare("UPDATE ip_addresses SET last_seen=datetime('now'), last_status='online', updated_at=datetime('now') WHERE id=?").run(ip.id);
    res.json({ online: true, latency_ms: latency });
  } catch {
    db.prepare("UPDATE ip_addresses SET last_status='offline', updated_at=datetime('now') WHERE id=?").run(ip.id);
    res.json({ online: false });
  }
});

// POST /api/ipspace/import — import from scan results
router.post('/import', requireRole('superadmin', 'admin', 'operator'), (req, res) => {
  const { scan_id, vlan_id, items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'No items to import' });

  let imported = 0, skipped = 0;
  for (const item of items) {
    if (!item.ip_address) continue;
    try {
      db.prepare(`
        INSERT INTO ip_addresses (ip_address, hostname, mac_address, vlan_id, purpose, description, last_seen, last_status)
        VALUES (?,?,?,?,?,?,datetime('now'),'online')
        ON CONFLICT(ip_address) DO UPDATE SET
          hostname    = COALESCE(excluded.hostname, hostname),
          mac_address = COALESCE(excluded.mac_address, mac_address),
          last_seen   = datetime('now'),
          last_status = 'online',
          updated_at  = datetime('now')
      `).run(
        item.ip_address, item.hostname||null, item.mac_address||null,
        vlan_id ? parseInt(vlan_id) : null,
        item.purpose || 'other', item.description || (scan_id ? `Imported from scan #${scan_id}` : 'Imported')
      );
      imported++;
    } catch { skipped++; }
  }

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'ipspace', entityName: `Import: ${imported} IPs`, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true, imported, skipped });
});

module.exports = router;
