'use strict';
const crypto = require('crypto');

// ── Key derivation ────────────────────────────────────────────────────────────
// Derives a 32-byte key from APP_SECRET using HKDF-like approach
function getKey() {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET not set — cannot encrypt/decrypt');
  return crypto.createHash('sha256').update(`krajcara-enc-v1:${secret}`).digest();
}

// ── Encrypt ───────────────────────────────────────────────────────────────────
// Returns: "enc:v1:<base64(iv+tag+ciphertext)>"
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  try {
    const key    = getKey();
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc    = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, enc]).toString('base64');
    return `enc:v1:${payload}`;
  } catch (e) {
    console.error('[Encryption] encrypt error:', e.message);
    return plaintext; // fallback — better to store plain than crash
  }
}

// ── Decrypt ───────────────────────────────────────────────────────────────────
// Handles both encrypted ("enc:v1:...") and legacy plain text values
function decrypt(value) {
  if (!value) return value;
  if (!value.startsWith('enc:v1:')) return value; // legacy plain text
  try {
    const key     = getKey();
    const buf     = Buffer.from(value.slice(7), 'base64');
    const iv      = buf.slice(0, 12);
    const tag     = buf.slice(12, 28);
    const enc     = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[Encryption] decrypt error:', e.message);
    return null; // corrupted or wrong key
  }
}

// ── Check if value is encrypted ───────────────────────────────────────────────
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

module.exports = { encrypt, decrypt, isEncrypted };
