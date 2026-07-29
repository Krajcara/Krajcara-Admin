'use strict';
// Called once at startup — encrypts any plain-text sensitive fields
// Safe to run multiple times (skips already-encrypted values)

const { encrypt, isEncrypted } = require('../services/encryptionService');

function migrateEncryption(db) {
  let total = 0;

  const migrateField = (table, idCol, field) => {
    try {
      const rows = db.prepare(`SELECT ${idCol}, ${field} FROM ${table} WHERE ${field} IS NOT NULL AND ${field} != ''`).all();
      let count = 0;
      for (const row of rows) {
        const val = row[field];
        if (!isEncrypted(val)) {
          db.prepare(`UPDATE ${table} SET ${field} = ? WHERE ${idCol} = ?`).run(encrypt(val), row[idCol]);
          count++;
        }
      }
      if (count > 0) {
        console.log(`[EncMigration] ${table}.${field}: encrypted ${count} value(s)`);
        total += count;
      }
    } catch (e) {
      // Table or column may not exist yet — skip silently
      if (!e.message.includes('no such table') && !e.message.includes('no such column')) {
        console.error(`[EncMigration] ${table}.${field} error:`, e.message);
      }
    }
  };

  // SSH servers
  migrateField('ssh_servers',  'id', 'ssh_password');
  migrateField('ssh_servers',  'id', 'ssh_key');
  migrateField('ssh_servers',  'id', 'ssh_passphrase');

  // WinRM servers
  migrateField('winrm_servers','id', 'winrm_password');

  // Licences
  migrateField('licences',     'id', 'licence_password');

  // Entra ID (client_secret)
  migrateField('entra_apps',   'id', 'client_secret');

  // Routers (SNMP passwords)
  migrateField('routers',      'id', 'snmp_auth_password');
  migrateField('routers',      'id', 'snmp_priv_password');

  // DNS local (api_key)
  migrateField('dns_local',    'id', 'api_key');

  // Settings (sensitive keys stored as key/value)
  const sensitiveSettingsKeys = [
    'proxmox_api_token',
    'cloudflare_api_token',
    'smtp_pass',
    'm365_client_secret',
  ];
  for (const key of sensitiveSettingsKeys) {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      if (row?.value && !isEncrypted(row.value)) {
        db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(encrypt(row.value), key);
        console.log(`[EncMigration] settings.${key}: encrypted`);
        total++;
      }
    } catch (e) {
      if (!e.message.includes('no such table')) {
        console.error(`[EncMigration] settings.${key} error:`, e.message);
      }
    }
  }

  if (total > 0) console.log(`[EncMigration] Done — ${total} value(s) encrypted`);
}

module.exports = { migrateEncryption };
