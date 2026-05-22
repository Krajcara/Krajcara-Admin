const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth);

const BRANDS = ['mikrotik', 'cisco', 'fortigate', 'ubiquiti', 'juniper', 'hp', 'aruba', 'other'];

// GET /api/routers
router.get('/', (req, res) => {
  const routers = db.prepare(
    'SELECT id,name,brand,model,ip_address,username,notes,snmp_version,snmp_community,snmp_port,snmp_username,snmp_auth_protocol,snmp_priv_protocol,snmp_security_level,created_at FROM routers ORDER BY name'
  ).all();
  res.json(routers);
});

// POST /api/routers
router.post('/', requireRole('superadmin', 'admin'), (req, res) => {
  const {
    name, brand, model, ip_address, username, password, notes,
    snmp_version, snmp_community, snmp_port, snmp_username,
    snmp_auth_protocol, snmp_auth_password, snmp_priv_protocol, snmp_priv_password, snmp_security_level
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!ip_address?.trim()) return res.status(400).json({ error: 'IP address is required' });

  const r = db.prepare(`
    INSERT INTO routers
      (name, brand, model, ip_address, username, password_encrypted, notes,
       snmp_version, snmp_community, snmp_port, snmp_username,
       snmp_auth_protocol, snmp_auth_password, snmp_priv_protocol, snmp_priv_password, snmp_security_level)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    name.trim(), brand || 'other', model || null, ip_address.trim(),
    username || null, password || null, notes || null,
    snmp_version || '2c', snmp_community || 'public', parseInt(snmp_port) || 161,
    snmp_username || null, snmp_auth_protocol || 'SHA', snmp_auth_password || null,
    snmp_priv_protocol || 'AES', snmp_priv_password || null, snmp_security_level || 'authPriv'
  );

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'routers', entityId: r.lastInsertRowid, entityName: name, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ id: r.lastInsertRowid });
});

// PUT /api/routers/:id
router.put('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    name, brand, model, ip_address, username, password, notes,
    snmp_version, snmp_community, snmp_port, snmp_username,
    snmp_auth_protocol, snmp_auth_password, snmp_priv_protocol, snmp_priv_password, snmp_security_level
  } = req.body;

  // Only update password if a real new value was provided
  const newPass = password && password.trim() && password !== '***' ? password : existing.password_encrypted;
  const newSnmpAuth = snmp_auth_password && snmp_auth_password !== '***' ? snmp_auth_password : existing.snmp_auth_password;
  const newSnmpPriv = snmp_priv_password && snmp_priv_password !== '***' ? snmp_priv_password : existing.snmp_priv_password;

  db.prepare(`
    UPDATE routers SET
      name=?, brand=?, model=?, ip_address=?, username=?, password_encrypted=?, notes=?,
      snmp_version=?, snmp_community=?, snmp_port=?, snmp_username=?,
      snmp_auth_protocol=?, snmp_auth_password=?, snmp_priv_protocol=?, snmp_priv_password=?,
      snmp_security_level=?
    WHERE id=?
  `).run(
    name ?? existing.name, brand ?? existing.brand, model ?? existing.model,
    ip_address ?? existing.ip_address, username ?? existing.username, newPass, notes ?? existing.notes,
    snmp_version ?? existing.snmp_version, snmp_community ?? existing.snmp_community,
    snmp_port ? parseInt(snmp_port) : existing.snmp_port,
    snmp_username ?? existing.snmp_username,
    snmp_auth_protocol ?? existing.snmp_auth_protocol, newSnmpAuth,
    snmp_priv_protocol ?? existing.snmp_priv_protocol, newSnmpPriv,
    snmp_security_level ?? existing.snmp_security_level,
    req.params.id
  );

  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'routers', entityId: req.params.id, entityName: name ?? existing.name, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// DELETE /api/routers/:id
router.delete('/:id', requireRole('superadmin', 'admin'), (req, res) => {
  const r = db.prepare('SELECT name FROM routers WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM routers WHERE id = ?').run(req.params.id);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'routers', entityId: req.params.id, entityName: r.name, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// GET /api/routers/:id/ping — basic connectivity check
router.get('/:id/ping', async (req, res) => {
  const r = db.prepare('SELECT ip_address, name FROM routers WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  try {
    const { execSync } = require('child_process');
    const start = Date.now();
    execSync(`ping -c 1 -W 3 ${r.ip_address}`, { timeout: 5000 });
    res.json({ alive: true, latency_ms: Date.now() - start, ip: r.ip_address });
  } catch {
    res.json({ alive: false, ip: r.ip_address });
  }
});

// GET /api/routers/:id/stats — SNMP stats (uptime, cpu, mem, interfaces)
router.get('/:id/stats', async (req, res) => {
  const r = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });

  const brand   = (r.brand || '').toLowerCase();
  const snmpCfg = {
    snmp_version:        r.snmp_version       || '2c',
    snmp_community:      r.snmp_community      || 'public',
    snmp_port:           r.snmp_port           || 161,
    snmp_username:       r.snmp_username       || '',
    snmp_auth_protocol:  r.snmp_auth_protocol  || 'SHA',
    snmp_auth_password:  r.snmp_auth_password  || '',
    snmp_priv_protocol:  r.snmp_priv_protocol  || 'AES',
    snmp_priv_password:  r.snmp_priv_password  || '',
    snmp_security_level: r.snmp_security_level || 'authPriv',
    model: r.model,
  };

  try {
    if (brand === 'mikrotik') {
      const { pollMikrotikSnmp } = require('../lib/snmp-mikrotik');
      return res.json(await pollMikrotikSnmp(r.ip_address, snmpCfg));
    }
    if (brand === 'fortigate') {
      const { pollFortigate } = require('../lib/snmp-fortigate');
      return res.json(await pollFortigate(r.ip_address, snmpCfg));
    }
    if (brand === 'cisco') {
      const { pollCisco } = require('../lib/snmp-cisco');
      return res.json(await pollCisco(r.ip_address, snmpCfg));
    }
    // Generic — standard MIBs only (sysDescr, sysUpTime, ifTable)
    const { genericSnmpStats } = require('../lib/snmp-generic');
    return res.json(await genericSnmpStats(r.ip_address, snmpCfg));
  } catch (err) {
    res.json({ connected: false, brand, error: err.message });
  }
});

module.exports = router;
