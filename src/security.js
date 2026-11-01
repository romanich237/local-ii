'use strict';

const crypto = require('node:crypto');
const b64url = value => Buffer.from(value).toString('base64url');

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
function createApiKey() {
  return `lai_${crypto.randomBytes(32).toString('base64url')}`;
}
function encryptionKey(secret) {
  return crypto.scryptSync(String(secret), 'local-ii-api-key-encryption-v1', 32);
}
function encryptApiKey(key, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decryptApiKey(payload, secret) {
  const [version, iv, tag, encrypted] = String(payload || '').split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Невозможно расшифровать API-ключ');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function signSession(secret, ttlSeconds = 86400) {
  const payload = b64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds, nonce: crypto.randomBytes(8).toString('hex') }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifySession(token, secret) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    return JSON.parse(Buffer.from(payload, 'base64url')).exp > Date.now() / 1000;
  } catch { return false; }
}
module.exports = { createApiKey, hashApiKey, encryptApiKey, decryptApiKey, hashPassword, verifyPassword, signSession, verifySession };
