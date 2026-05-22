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

// Phase 2 — Licences & Entra Apps tables
db.exec(`
  CREATE TABLE IF NOT EXISTS licences (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor             TEXT NOT NULL,
    licence_type       TEXT NOT NULL,
    licence_count      INTEGER DEFAULT 1,
    licence_used       INTEGER DEFAULT 0,
    purchase_date      TEXT,
    expiry_date        TEXT,
    price_per_licence  REAL,
    currency           TEXT DEFAULT 'EUR',
    billing_cycle      TEXT DEFAULT 'annual',
    tax_percent        REAL DEFAULT 0,
    is_free            INTEGER DEFAULT 0,
    active_users       INTEGER,
    assigned_to        TEXT DEFAULT '[]',
    url                TEXT,
    licence_username   TEXT,
    licence_password   TEXT,
    licence_mfa        INTEGER DEFAULT 0,
    notes              TEXT,
    hidden             INTEGER DEFAULT 0,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entra_apps (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name       TEXT NOT NULL,
    app_id         TEXT,
    client_secret  TEXT,
    secret_expiry  TEXT,
    assigned_to    TEXT,
    project        TEXT,
    notes          TEXT,
    hidden         INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );
`);

// Phase 3 — Network tables
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'http',
    target          TEXT NOT NULL,
    port            INTEGER,
    interval_s      INTEGER DEFAULT 60,
    timeout_s       INTEGER DEFAULT 10,
    keyword         TEXT,
    expected_status INTEGER DEFAULT 200,
    enabled         INTEGER DEFAULT 1,
    last_status     TEXT DEFAULT 'unknown',
    last_latency_ms INTEGER,
    last_checked_at TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monitor_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  INTEGER NOT NULL,
    status      TEXT NOT NULL,
    latency_ms  INTEGER,
    status_code INTEGER,
    error_msg   TEXT,
    checked_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor ON monitor_checks(monitor_id, checked_at);

  CREATE TABLE IF NOT EXISTS routers (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    brand                TEXT NOT NULL DEFAULT 'other',
    model                TEXT,
    ip_address           TEXT,
    username             TEXT,
    password_encrypted   TEXT,
    notes                TEXT,
    snmp_version         TEXT DEFAULT '2c',
    snmp_community       TEXT DEFAULT 'public',
    snmp_port            INTEGER DEFAULT 161,
    snmp_username        TEXT,
    snmp_auth_protocol   TEXT DEFAULT 'SHA',
    snmp_auth_password   TEXT,
    snmp_priv_protocol   TEXT DEFAULT 'AES',
    snmp_priv_password   TEXT,
    snmp_security_level  TEXT DEFAULT 'authPriv',
    created_at           TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dns_local (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL DEFAULT 'primary',
    type       TEXT NOT NULL DEFAULT 'technitium',
    ip         TEXT NOT NULL,
    api_key    TEXT,
    label      TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dns_domains (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    domain     TEXT UNIQUE NOT NULL,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Cleanup old monitor checks (keep 7 days)
try {
  db.prepare("DELETE FROM monitor_checks WHERE checked_at < datetime('now', '-7 days')").run();
} catch {}
