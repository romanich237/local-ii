'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiKey, hashApiKey, hashPassword, verifyPassword, signSession, verifySession } = require('../src/security');

test('API-ключ имеет безопасный формат и стабильный хэш', () => {
  const key = createApiKey();
  assert.match(key, /^lai_[A-Za-z0-9_-]{43}$/);
  assert.equal(hashApiKey(key), hashApiKey(key));
});

test('пароль проверяется через scrypt', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('подписанная сессия проверяется', () => {
  const token = signSession('secret');
  assert.equal(verifySession(token, 'secret'), true);
  assert.equal(verifySession(token, 'another'), false);
});
