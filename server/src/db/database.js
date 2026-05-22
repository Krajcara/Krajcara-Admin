const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/krajcara-admin.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name    TEXT,
    email        TEXT,
    role         TEXT DEFAULT 'viewer',
    is_active    INTEGER DEFAULT 1,
    first_login  INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now')),
    last_login   TEXT
  );

  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    permissions TEXT DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    username    TEXT,
    action      TEXT NOT NULL,
    module      TEXT NOT NULL,
    entity_id   TEXT,
    entity_name TEXT,
    detail      TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    status      TEXT DEFAULT 'success',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_totp (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER UNIQUE NOT NULL,
    secret       TEXT,
    enabled      INTEGER DEFAULT 0,
    backup_codes TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_api_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    key_hash   TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    last_used  TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_module  ON audit_log(module);
  CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(username);
`);

// ── Seed default admin if no users exist ─────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
if (userCount.cnt === 0) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, email, role, first_login)
    VALUES ('admin', ?, 'Administrator', ?, 'superadmin', 1)
  `).run(hash, process.env.ADMIN_EMAIL || 'admin@krajcara.local');
  console.log('[DB] Default admin user created');
}

module.exports = db;
