'use strict';

const express = require('express');
const helmet = require('helmet');
const { loadConfig } = require('./config');
const { statements } = require('./db');
const { createApiKey, hashApiKey, verifyPassword, signSession, verifySession } = require('./security');
const { loginPage, dashboard, docsPage } = require('./ui');

const config = loadConfig();
const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const loginAttempts = new Map();
function cookieMap(req) {
  try {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
  } catch { return {}; }
}
function isAdmin(req) { return verifySession(cookieMap(req).lai_session, config.sessionSecret); }
function requireAdmin(req, res, next) { return isAdmin(req) ? next() : res.redirect('/auth/login'); }
function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function estimateTokens(value) { return Math.ceil(JSON.stringify(value ?? '').length / 4); }

app.get('/', (_req, res) => res.json({ service: 'Local AI Server', status: 'ok', base_url: config.baseUrl, models: `${config.baseUrl}/models`, docs: '/docs', panel: '/auth/' }));
app.get('/docs', (_req, res) => res.send(docsPage({ baseUrl: config.baseUrl, model: config.defaultModel })));
app.get('/health', async (_req, res) => {
  try {
    const upstream = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    res.status(upstream.ok ? 200 : 503).json({ status: upstream.ok ? 'ok' : 'degraded', ollama: upstream.ok, model: config.defaultModel });
  } catch { res.status(503).json({ status: 'degraded', ollama: false, model: config.defaultModel }); }
});

function authorizeApi(req, res, next) {
  const rawKey = bearer(req);
  const key = rawKey && statements.findKey.get(hashApiKey(rawKey));
  if (!key) return res.status(401).json({ error: { message: 'Недействительный API-ключ', type: 'authentication_error' } });
  const used = statements.monthUsage.get(key.id).total;
  if (key.monthly_limit > 0 && used >= key.monthly_limit) return res.status(429).json({ error: { message: 'Месячный лимит токенов исчерпан', type: 'rate_limit_error' } });
  req.apiKey = key;
  next();
}

app.get('/v1/models', authorizeApi, async (req, res) => {
  try {
    const upstream = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) throw new Error(`Ollama: ${upstream.status}`);
    const result = await upstream.json();
    statements.touchKey.run(req.apiKey.id);
    res.json({ object: 'list', data: (result.models || []).map(m => ({ id: m.name, object: 'model', created: Math.floor(new Date(m.modified_at).getTime() / 1000), owned_by: 'local' })) });
  } catch (error) { res.status(502).json({ error: { message: error.message, type: 'upstream_error' } }); }
});

app.post('/v1/chat/completions', express.json({ limit: '2mb' }), authorizeApi, async (req, res) => {
  const started = Date.now();
  const model = req.body.model || config.defaultModel;
  const stream = Boolean(req.body.stream);
  const promptEstimate = estimateTokens(req.body.messages);
  let statusCode = 502;
  let completionTokens = 0;
  try {
    const upstream = await fetch(`${config.ollamaUrl}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req.body, model }), signal: AbortSignal.timeout(30 * 60 * 1000)
    });
    statusCode = upstream.status;
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    if (stream && upstream.body) {
      const reader = upstream.body.getReader();
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (!res.write(Buffer.from(value))) await new Promise(resolve => res.once('drain', resolve));
      }
      completionTokens = Math.ceil(bytes / 16);
      res.end();
    } else {
      const text = await upstream.text();
      try {
        const data = JSON.parse(text);
        completionTokens = data.usage?.completion_tokens ?? estimateTokens(data.choices?.[0]?.message?.content);
        const promptTokens = data.usage?.prompt_tokens ?? promptEstimate;
        req.usage = { promptTokens, completionTokens, totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens };
      } catch { completionTokens = estimateTokens(text); }
      res.send(text);
    }
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: { message: `Модель недоступна: ${error.message}`, type: 'upstream_error' } });
    else res.end();
  } finally {
    const promptTokens = req.usage?.promptTokens ?? promptEstimate;
    const totalTokens = req.usage?.totalTokens ?? promptTokens + completionTokens;
    statements.recordUsage.run(req.apiKey.id, model, promptTokens, completionTokens, totalTokens, Date.now() - started, statusCode);
    statements.touchKey.run(req.apiKey.id);
  }
});

app.get('/auth/login', (req, res) => isAdmin(req) ? res.redirect('/auth/') : res.send(loginPage()));
app.post('/auth/login', (req, res) => {
  const ip = req.ip;
  const state = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  if (state.blockedUntil > Date.now()) return res.status(429).send(loginPage('Слишком много попыток. Повторите через 15 минут.'));
  const validUsername = String(req.body.username || '') === config.adminUsername;
  const validPassword = verifyPassword(req.body.password || '', config.adminPasswordHash);
  if (!validUsername || !validPassword) {
    state.count += 1;
    if (state.count >= 5) { state.blockedUntil = Date.now() + 15 * 60_000; state.count = 0; }
    loginAttempts.set(ip, state);
    return res.status(401).send(loginPage('Неверный пароль'));
  }
  loginAttempts.delete(ip);
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie('lai_session', signSession(config.sessionSecret), { httpOnly: true, sameSite: 'strict', secure, maxAge: 86400_000, path: '/auth' });
  res.redirect('/auth/');
});
app.get('/auth/logout', (_req, res) => { res.clearCookie('lai_session', { path: '/auth' }); res.redirect('/auth/login'); });
app.get('/auth/', requireAdmin, (req, res) => {
  const newKey = cookieMap(req).lai_new_key || '';
  if (newKey) res.clearCookie('lai_new_key', { path: '/auth' });
  res.send(dashboard({ keys: statements.listKeys.all(), totals: statements.totals.get(), recent: statements.recent.all(), model: config.defaultModel, baseUrl: config.baseUrl, newKey }));
});
app.post('/auth/keys', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const monthlyLimit = Math.max(0, Number.parseInt(req.body.monthlyLimit || '0', 10) || 0);
  if (!name) return res.status(400).send('Название обязательно');
  const key = createApiKey();
  statements.createKey.run(name, hashApiKey(key), key.slice(0, 12), monthlyLimit);
  res.cookie('lai_new_key', key, { httpOnly: true, sameSite: 'strict', secure: req.secure || req.get('x-forwarded-proto') === 'https', maxAge: 60_000, path: '/auth' });
  res.redirect('/auth/');
});
app.post('/auth/keys/:id/toggle', requireAdmin, (req, res) => {
  const id = Number(req.params.id); const key = statements.listKeys.all().find(k => k.id === id);
  if (key) statements.toggleKey.run(key.enabled ? 0 : 1, id);
  res.redirect('/auth/');
});
app.post('/auth/keys/:id/delete', requireAdmin, (req, res) => { statements.deleteKey.run(Number(req.params.id)); res.redirect('/auth/'); });

app.use((_req, res) => res.status(404).json({ error: { message: 'Маршрут не найден', type: 'not_found' } }));
app.listen(config.port, '127.0.0.1', () => console.log(`Local AI Server: http://127.0.0.1:${config.port} | модель: ${config.defaultModel}`));
