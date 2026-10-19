/* ============================================================
   utils/totp.js
   Self-contained TOTP (RFC 6238) implementation.
   No external dependencies — works with every otplib version
   (or without otplib installed at all).
   ============================================================ */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a base32 string (RFC 4648) into a Buffer.
 * Ignores padding and whitespace.
 */
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];

  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/**
 * Compute a 6-digit HOTP value for a given counter.
 * Uses HMAC-SHA1 (what Google Authenticator / Authy expect by default).
 */
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
     (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code with ±1 window (allows 30s clock drift).
 * Returns true if valid, false otherwise.
 */
function verifyTOTP(code, secret) {
  if (!code || !secret) return false;
  const cleanCode = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const secretBuf = base32Decode(secret);
  if (secretBuf.length === 0) return false;

  const step = 30;
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / step);

  for (const drift of [-1, 0, 1]) {
    if (hotp(secretBuf, counter + drift) === cleanCode) return true;
  }
  return false;
}

/**
 * Generate a random base32 secret.
 * Default 20 bytes → 32 base32 characters (standard TOTP length).
 */
function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let out = '';
  for (const b of buf) out += BASE32_ALPHABET[b % 32];
  return out;
}

/**
 * Build a standard otpauth:// URI that authenticator apps can scan.
 * Format: otpauth://totp/{issuer}:{account}?secret=...&issuer=...&...
 */
function buildOtpAuthURI({ issuer = 'NovaWallet', account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  verifyTOTP,
  generateSecret,
  buildOtpAuthURI,
  base32Decode,
  hotp
};