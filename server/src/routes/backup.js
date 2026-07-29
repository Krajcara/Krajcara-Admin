'use strict';
const express    = require('express');
const router     = express.Router();
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const zlib       = require('zlib');
const db         = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '../../../data/krajcara-admin.db');
const ENV_PATH   = process.env.ENV_PATH || path.join(__dirname, '../../../.env');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

router.use(requireAuth);
router.use(requireRole('superadmin'));

// ── Crypto helpers ─────────────────────────────────────────────────────────────
// Encrypt env content with password using AES-256-GCM
function encryptEnv(plaintext, password) {
  const salt = crypto.randomBytes(32);
  const key  = crypto.scryptSync(password, salt, 32);
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  // Format: salt(32) + iv(12) + tag(16) + data
  return Buffer.concat([salt, iv, tag, enc]);
}

function decryptEnv(buf, password) {
  const salt = buf.slice(0, 32);
  const iv   = buf.slice(32, 44);
  const tag  = buf.slice(44, 60);
  const enc  = buf.slice(60);
  const key  = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── Simple ZIP builder (no external deps) ─────────────────────────────────────
// Creates a minimal valid ZIP archive from a list of { name, data } entries
function buildZip(entries) {
  const localHeaders = [];
  const centralDir   = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data      = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc       = crc32(data);
    const now       = new Date();
    const dosTime   = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1));
    const dosDate   = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());

    // Local file header
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // compression (stored)
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    localHeaders.push(Buffer.concat([local, data]));

    // Central directory entry
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralDir.push(central);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centralDir);
  const eocd       = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralBuf, eocd]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Parse ZIP (minimal — finds entries by local header signatures) ─────────────
function parseZip(buf) {
  const entries = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const nameLen  = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const compSize = buf.readUInt32LE(i + 18);
      const name     = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
      const dataOff  = i + 30 + nameLen + extraLen;
      entries[name]  = buf.slice(dataOff, dataOff + compSize);
      i = dataOff + compSize;
    } else {
      i++;
    }
  }
  return entries;
}

// ── GET /api/backup/info ───────────────────────────────────────────────────────
router.get('/info', (req, res) => {
  try {
    const stat    = fs.statSync(DB_PATH);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db') || f.endsWith('.zip'))
      .map(f => {
        const fp = path.join(BACKUP_DIR, f);
        const s  = fs.statSync(fp);
        const isZip = f.endsWith('.zip');
        return { name: f, size: s.size, created: s.mtime.toISOString(), type: isZip ? 'full' : 'db-only' };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    const hasEnv = fs.existsSync(ENV_PATH);
    res.json({ db_path: DB_PATH, db_size: stat.size, db_modified: stat.mtime.toISOString(), backup_dir: BACKUP_DIR, backups, has_env: hasEnv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/backup/download — download full backup ZIP ───────────────────────
router.get('/download', (req, res) => {
  try {
    const password = req.query.password;
    db.pragma('wal_checkpoint(TRUNCATE)');
    const date     = new Date().toISOString().split('T')[0];
    const dbData   = fs.readFileSync(DB_PATH);
    const entries  = [{ name: 'krajcara-admin.db', data: dbData }];

    if (password && fs.existsSync(ENV_PATH)) {
      const envContent   = fs.readFileSync(ENV_PATH, 'utf8');
      const encryptedEnv = encryptEnv(envContent, password);
      entries.push({ name: 'env.enc', data: encryptedEnv });
    }

    // Include manifest
    const manifest = JSON.stringify({
      version:    '2',
      created_at: new Date().toISOString(),
      has_env:    !!password && fs.existsSync(ENV_PATH),
      app:        'krajcara-admin',
    }, null, 2);
    entries.push({ name: 'manifest.json', data: manifest });

    const zipBuf  = buildZip(entries);
    const filename = `krajcara-admin-backup-${date}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zipBuf.length);
    res.send(zipBuf);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'backup', entityName: filename, ip: req.ip, userAgent: req.headers['user-agent'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/backup/trigger — save local backup ──────────────────────────────
router.post('/trigger', (req, res) => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `krajcara-admin-backup-${ts}.db`);
    db.exec(`VACUUM INTO '${dest}'`);

    const all = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.match(/^krajcara-admin-backup-\d/) && f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (all.length > 10) all.slice(10).forEach(b => { try { fs.unlinkSync(b.path); } catch {} });

    const stat = fs.statSync(dest);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'backup', entityName: path.basename(dest), ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true, filename: path.basename(dest), size: stat.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/backup/:name ──────────────────────────────────────────────────
router.delete('/:name', (req, res) => {
  const name = path.basename(req.params.name);
  if (!name.endsWith('.db') && !name.endsWith('.zip')) return res.status(400).json({ error: 'Invalid filename' });
  const fp = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'backup', entityName: name, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// ── POST /api/backup/restore — restore from .db or .zip ───────────────────────
router.post('/restore', (req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf      = Buffer.concat(chunks);
    const filename = req.headers['x-filename'] || 'upload';
    const password = req.headers['x-env-password'] || '';

    let dbBuf = null;
    let envContent = null;
    let hasEnvInZip = false;

    // Detect ZIP vs raw DB
    const isZip = buf.slice(0, 4).toString('hex') === '504b0304';
    if (isZip) {
      try {
        const entries = parseZip(buf);
        if (!entries['krajcara-admin.db']) return res.status(400).json({ error: 'ZIP does not contain krajcara-admin.db' });
        dbBuf = entries['krajcara-admin.db'];

        if (entries['manifest.json']) {
          const manifest = JSON.parse(entries['manifest.json'].toString('utf8'));
          hasEnvInZip = manifest.has_env === true;
        }
        if (entries['env.enc']) {
          hasEnvInZip = true;
          if (password) {
            try {
              envContent = decryptEnv(entries['env.enc'], password);
            } catch {
              return res.status(400).json({ error: 'Wrong password for .env decryption' });
            }
          }
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid ZIP file: ' + e.message });
      }
    } else {
      dbBuf = buf;
    }

    // Validate SQLite magic bytes
    const magic = Buffer.from('SQLite format 3\0');
    if (!dbBuf.slice(0, 16).equals(magic)) return res.status(400).json({ error: 'Invalid SQLite database file' });

    // Validate integrity
    let tmpDb;
    const tmpPath = DB_PATH + '.restore-tmp';
    try {
      fs.writeFileSync(tmpPath, dbBuf);
      tmpDb = new (require('better-sqlite3'))(tmpPath, { readonly: true });
      const check = tmpDb.prepare('PRAGMA integrity_check').get();
      if (check['integrity_check'] !== 'ok') {
        tmpDb.close(); fs.unlinkSync(tmpPath);
        return res.status(400).json({ error: 'Database integrity check failed' });
      }
      const hasUsers = tmpDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!hasUsers) {
        tmpDb.close(); fs.unlinkSync(tmpPath);
        return res.status(400).json({ error: 'Not a Krajcara Admin database' });
      }
      tmpDb.close();
    } catch (e) {
      try { if (tmpDb) tmpDb.close(); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      return res.status(400).json({ error: 'Cannot open database: ' + e.message });
    }

    // Auto-backup current DB before restore
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      db.exec(`VACUUM INTO '${path.join(BACKUP_DIR, `pre-restore-${ts}.db`)}'`);
    } catch {}

    // Replace DB
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch {} }
    fs.renameSync(tmpPath, DB_PATH);

    // Replace .env if decrypted
    if (envContent) {
      try {
        fs.writeFileSync(ENV_PATH, envContent, { mode: 0o600 });
      } catch (e) {
        console.error('[Backup] Failed to restore .env:', e.message);
      }
    }

    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'backup', entityName: 'restore', ip: req.ip, userAgent: req.headers['user-agent'] });

    const msg = envContent
      ? 'Database and .env restored. Server restarting...'
      : hasEnvInZip && !password
      ? 'Database restored. .env was NOT restored (no password provided). Server restarting...'
      : 'Database restored. Server restarting...';

    res.json({ ok: true, message: msg, env_restored: !!envContent });
    setTimeout(() => { console.log('[Backup] Restarting after restore...'); process.exit(0); }, 500);
  });
});

// ── Auto-backup (called from scheduler) ───────────────────────────────────────
function runAutoBackup() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `auto-backup-${ts}.db`);
    db.exec(`VACUUM INTO '${dest}'`);
    const autoBackups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('auto-backup-') && f.endsWith('.db'))
      .map(f => ({ path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (autoBackups.length > 7) autoBackups.slice(7).forEach(b => { try { fs.unlinkSync(b.path); } catch {} });
    console.log(`[Backup] Auto-backup: ${path.basename(dest)}`);
  } catch (e) { console.error('[Backup] Auto-backup failed:', e.message); }
}

module.exports = { router, runAutoBackup };
