'use strict';

const crypto = require('node:crypto');

const b64url = (value) => Buffer.from(value).toString('base64url');

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createApiKey() {
  return `lai_${crypto.randomBytes(32).toString('base64url')}`;
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
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    return JSON.parse(Buffer.from(payload, 'base64url')).exp > Date.now() / 1000;
  } catch { return false; }
}

module.exports = { createApiKey, hashApiKey, hashPassword, verifyPassword, signSession, verifySession };
