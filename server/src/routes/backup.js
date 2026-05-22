'use strict';
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '../../../data/krajcara-admin.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

router.use(requireAuth);
router.use(requireRole('superadmin'));

// GET /api/backup/info
router.get('/info', (req, res) => {
  try {
    const stat    = fs.statSync(DB_PATH);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const fp = path.join(BACKUP_DIR, f);
        const s  = fs.statSync(fp);
        return { name: f, size: s.size, created: s.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      db_path:     DB_PATH,
      db_size:     stat.size,
      db_modified: stat.mtime.toISOString(),
      backup_dir:  BACKUP_DIR,
      backups,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/backup/download
router.get('/download', (req, res) => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const date     = new Date().toISOString().split('T')[0];
    const filename = `krajcara-admin-backup-${date}.db`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(DB_PATH).size);
    fs.createReadStream(DB_PATH).pipe(res);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'backup', entityName: filename, ip: req.ip, userAgent: req.headers['user-agent'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/backup/trigger — save local backup
router.post('/trigger', (req, res) => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `krajcara-admin-backup-${ts}.db`);
    db.exec(`VACUUM INTO '${dest}'`);

    // Keep last 10 backups
    const all = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (all.length > 10) all.slice(10).forEach(b => { try { fs.unlinkSync(b.path); } catch {} });

    const stat = fs.statSync(dest);
    writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'create', module: 'backup', entityName: path.basename(dest), ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true, filename: path.basename(dest), size: stat.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/backup/:name
router.delete('/:name', (req, res) => {
  const name = path.basename(req.params.name); // prevent path traversal
  if (!name.endsWith('.db')) return res.status(400).json({ error: 'Invalid filename' });
  const fp = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'delete', module: 'backup', entityName: name, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
});

// POST /api/backup/restore — upload and restore
router.post('/restore', (req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);

    // Validate SQLite magic bytes
    const magic = Buffer.from('SQLite format 3\0');
    if (!buf.slice(0, 16).equals(magic)) {
      return res.status(400).json({ error: 'Invalid SQLite database file' });
    }

    try {
      const tmpPath = DB_PATH + '.restore-tmp';
      fs.writeFileSync(tmpPath, buf);

      // Validate integrity
      let tmpDb;
      try {
        tmpDb = new (require('better-sqlite3'))(tmpPath, { readonly: true });
        const check = tmpDb.prepare('PRAGMA integrity_check').get();
        if (check['integrity_check'] !== 'ok') {
          tmpDb.close(); fs.unlinkSync(tmpPath);
          return res.status(400).json({ error: 'Integrity check failed: ' + check['integrity_check'] });
        }
        const hasUsers = tmpDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
        if (!hasUsers) {
          tmpDb.close(); fs.unlinkSync(tmpPath);
          return res.status(400).json({ error: 'Not a Krajcara Admin database (missing users table)' });
        }
        tmpDb.close();
      } catch (e) {
        try { if (tmpDb) tmpDb.close(); } catch {}
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: 'Cannot open database: ' + e.message });
      }

      // Auto-backup current DB before restore
      db.pragma('wal_checkpoint(TRUNCATE)');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      db.exec(`VACUUM INTO '${path.join(BACKUP_DIR, `pre-restore-${ts}.db`)}'`);

      // Close current DB, replace file, restart
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(DB_PATH + ext); } catch {}
      }
      fs.renameSync(tmpPath, DB_PATH);

      writeAuditLog({ userId: req.user.id, username: req.user.username, action: 'update', module: 'backup', entityName: 'restore', ip: req.ip, userAgent: req.headers['user-agent'] });
      res.json({ ok: true, message: 'Database restored. Server restarting...' });

      setTimeout(() => { console.log('[Backup] Restarting after restore...'); process.exit(0); }, 500);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// Auto-backup (called from scheduler)
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
