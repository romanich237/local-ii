'use strict';

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const serviceVersion = require('../package.json').version;
const { loadConfig } = require('./config');
const { statements } = require('./db');
const { createApiKey, hashApiKey, encryptApiKey, decryptApiKey, verifyPassword, signSession, verifySession } = require('./security');
const { loginPage, dashboard, modelsPage, docsPage } = require('./ui');

const config = loadConfig();
const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'"], scriptSrc: ["'self'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use('/assets', express.static(path.join(config.root, 'public'), { fallthrough: false, maxAge: '1h' }));

const loginAttempts = new Map();
const modelJobs = new Map();
let previousCpuTimes = null;
const modelNamePattern = /^[a-zA-Z0-9._/-]+(?::[a-zA-Z0-9._-]+)?$/;
function cookieMap(req) {
  try {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
  } catch { return {}; }
}
function isAdmin(req) { return verifySession(cookieMap(req).lai_session, config.sessionSecret); }
function selectedTheme(req) { return cookieMap(req).lai_theme === 'light' ? 'light' : 'dark'; }
function isSecure(req) { return req.secure || req.get('x-forwarded-proto') === 'https'; }
function requireAdmin(req, res, next) { return isAdmin(req) ? next() : res.redirect('/auth/login'); }
function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function estimateTokens(value) { return Math.ceil(JSON.stringify(value ?? '').length / 4); }

function setAdminNotice(req, res, type, message) {
  res.cookie('lai_notice', JSON.stringify({ type, message }), {
    httpOnly: true, sameSite: 'strict', secure: isSecure(req), maxAge: 60_000, path: '/auth'
  });
}

async function listInstalledModels() {
  const upstream = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!upstream.ok) throw new Error(`Ollama вернула код ${upstream.status}`);
  const result = await upstream.json();
  return Array.isArray(result.models) ? result.models : [];
}

function startModelPull(model) {
  const job = { model, status: 'loading', message: 'Модель скачивается', startedAt: new Date().toISOString() };
  modelJobs.set(model, job);
  void (async () => {
    try {
      const upstream = await fetch(`${config.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false }),
        signal: AbortSignal.timeout(24 * 60 * 60 * 1000)
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok || result.error) throw new Error(result.error || `Ollama вернула код ${upstream.status}`);
      Object.assign(job, { status: 'success', message: 'Модель скачана', finishedAt: new Date().toISOString() });
    } catch (error) {
      Object.assign(job, { status: 'error', message: error.message, finishedAt: new Date().toISOString() });
    }
  })();
}

app.get('/', (_req, res) => res.json({ service: 'Local AI Server', status: 'ok', base_url: config.baseUrl, models: `${config.baseUrl}/models`, docs: '/docs', panel: '/auth/' }));
app.get(['/v1', '/v1/'], (_req, res) => res.json({
  object: 'api',
  name: 'Local AI Server',
  openai_compatible: true,
  base_url: config.baseUrl,
  endpoints: {
    models: `${config.baseUrl}/models`,
    chat_completions: `${config.baseUrl}/chat/completions`
  },
  default_model: config.defaultModel,
  documentation: `https://${config.domain}/docs`
}));
app.get('/docs', (req, res) => res.send(docsPage({ baseUrl: config.baseUrl, model: config.defaultModel, theme: selectedTheme(req) })));
app.get('/theme/:theme', (req, res) => {
  if (!['dark', 'light'].includes(req.params.theme)) return res.status(400).send('Неизвестная тема');
  const allowed = ['/docs', '/auth/', '/auth/login'];
  const next = allowed.includes(req.query.next) ? req.query.next : '/docs';
  res.cookie('lai_theme', req.params.theme, { httpOnly: true, sameSite: 'strict', secure: isSecure(req), maxAge: 365 * 86400_000, path: '/' });
  res.redirect(next);
});
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


app.get('/auth/update-status', requireAdmin, (_req, res) => {
  let status = {
    state: 'idle',
    installedVersion: serviceVersion,
    latestVersion: serviceVersion,
    checkedAt: null,
    message: 'Проверка обновлений ещё не выполнялась.'
  };
  try {
    status = { ...status, ...JSON.parse(fs.readFileSync(path.join(config.root, 'data', 'update-status.json'), 'utf8')) };
  } catch {}
  status.runtimeVersion = serviceVersion;
  status.installedVersion = serviceVersion;
  if (status.latestVersion && status.latestVersion !== serviceVersion) {
    status.state = 'available';
    status.message = 'Доступна версия ' + status.latestVersion + '. Установлена версия ' + serviceVersion + '.';
  } else if (status.state === 'current' || status.state === 'updated') {
    status.latestVersion = serviceVersion;
    status.message = 'Установлена последняя версия.';
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(status);
});

app.post('/auth/update-check', requireAdmin, (_req, res) => {
  try {
    const dataDir = path.join(config.root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'update-request'), JSON.stringify({ requestedAt: new Date().toISOString(), runtimeVersion: serviceVersion }) + '\n', { mode: 0o600 });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, message: 'Проверка обновлений поставлена в очередь.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Не удалось запустить проверку: ' + error.message });
  }
});

app.get('/auth/server-status', requireAdmin, async (_req, res) => {
  let ollama = false;
  let installedModels = 0;
  try {
    const response = await fetch(config.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(2500) });
    ollama = response.ok;
    if (ollama) installedModels = (await response.json()).models?.length || 0;
  } catch {}
  let disk = null;
  try {
    const stats = fs.statfsSync(config.root);
    disk = { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
    disk.used = Math.max(0, disk.total - disk.free);
    disk.percent = disk.total ? Math.round(disk.used / disk.total * 100) : 0;
  } catch {}
  const cpuTimes = os.cpus().map(cpu => cpu.times);
  const totals = cpuTimes.reduce((acc, times) => {
    acc.total += times.user + times.nice + times.sys + times.idle + times.irq;
    acc.idle += times.idle;
    return acc;
  }, { total: 0, idle: 0 });
  let cpuPercent = 0;
  if (previousCpuTimes) {
    const totalDelta = totals.total - previousCpuTimes.total;
    const idleDelta = totals.idle - previousCpuTimes.idle;
    if (totalDelta > 0) cpuPercent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
  }
  previousCpuTimes = totals;
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = Math.max(0, totalMemory - freeMemory);
  const memoryPercent = totalMemory ? Math.round(usedMemory / totalMemory * 100) : 0;
  let operatingSystem = os.type() + ' ' + os.release();
  try {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    const match = release.match(/^PRETTY_NAME=(?:\"([^\"]+)\"|'([^']+)'|([^\\n]+))$/m);
    if (match) operatingSystem = (match[1] || match[2] || match[3] || '').trim();
  } catch {}
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    version: serviceVersion, timeZone: config.timeZone || 'Europe/Moscow', hostname: os.hostname(),
    platform: operatingSystem, arch: os.arch(), uptimeSeconds: Math.floor(os.uptime()), cpuCores: os.cpus().length,
    cpu: { percent: cpuPercent },
    memory: { total: totalMemory, free: freeMemory, used: usedMemory, percent: memoryPercent },
    processMemory: process.memoryUsage().rss, disk, ollama, installedModels, defaultModel: config.defaultModel,
    telegramEnabled: Boolean(config.telegram?.enabled && config.telegram?.botToken && (config.telegram?.adminUserId || config.telegram?.adminChatId))
  });
});

app.post('/auth/chat', requireAdmin, express.json({ limit: '64kb' }), async (req, res) => {
  const model = String(req.body.model || config.defaultModel).trim();
  const systemPrompt = String(req.body.systemPrompt || '').slice(0, 12000);
  const maxTokens = Math.max(1, Math.min(32768, Number.parseInt(req.body.maxTokens, 10) || 1024));
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-40) : [];
  if (!modelNamePattern.test(model)) return res.status(400).json({ error: 'Некорректный тег модели' });
  if (!messages.length || messages.some(item => !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 20000)) {
    return res.status(400).json({ error: 'Передана некорректная история чата' });
  }
  const startedAt = Date.now();
  try {
    const upstream = await fetch(config.ollamaUrl + '/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages],
        max_tokens: maxTokens, stream: false
      }),
      signal: AbortSignal.timeout(30 * 60 * 1000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(502).json({ error: payload.error?.message || payload.error || 'Ollama вернула код ' + upstream.status });
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== 'string') return res.status(502).json({ error: 'Модель вернула пустой ответ' });
    const promptTokens = Number(payload.usage?.prompt_tokens ?? estimateTokens(messages));
    const completionTokens = Number(payload.usage?.completion_tokens ?? estimateTokens(answer));
    res.setHeader('Cache-Control', 'no-store');
    const totalTokens = Number(payload.usage?.total_tokens ?? promptTokens + completionTokens);
    const latencyMs = Date.now() - startedAt;
    statements.recordChatUsage.run(model, promptTokens, completionTokens, totalTokens, latencyMs, 200);
    res.json({
      answer, model,
      usage: { promptTokens, completionTokens, totalTokens },
      elapsedSeconds: Number((latencyMs / 1000).toFixed(2))
    });
  } catch (error) {
    res.status(502).json({ error: 'Не удалось получить ответ модели: ' + error.message });
  }
});

app.post('/auth/chat/python', requireAdmin, (req, res) => {
  const model = String(req.body.model || config.defaultModel).trim();
  const systemPrompt = String(req.body.systemPrompt || '').slice(0, 12000);
  const maxTokens = Math.max(1, Math.min(32768, Number.parseInt(req.body.maxTokens, 10) || 1024));
  if (!modelNamePattern.test(model)) return res.status(400).send('Некорректный тег модели');
  const script = [
    '#!/usr/bin/env python3',
    '"""Local AI Server client. Python 3.9+, standard library only."""',
    'import getpass, json, time, urllib.request, urllib.error',
    'BASE_URL = ' + JSON.stringify(config.baseUrl),
    'MODEL = ' + JSON.stringify(model),
    'SYSTEM_PROMPT = ' + JSON.stringify(systemPrompt),
    'MAX_TOKENS = ' + maxTokens,
    'def main():',
    '    api_key = getpass.getpass("API key: ").strip()',
    '    if not api_key: return',
    '    history = ([{"role": "system", "content": SYSTEM_PROMPT}] if SYSTEM_PROMPT else [])',
    '    print("Connected:", BASE_URL, "| model:", MODEL, "| max tokens:", MAX_TOKENS)',
    '    print("Type /exit to quit, /clear to clear history.")',
    '    while True:',
    '        prompt = input("\\nYou: ").strip()',
    '        if prompt == "/exit": break',
    '        if prompt == "/clear":',
    '            history = ([{"role": "system", "content": SYSTEM_PROMPT}] if SYSTEM_PROMPT else [])',
    '            print("History cleared."); continue',
    '        if not prompt: continue',
    '        history.append({"role": "user", "content": prompt})',
    '        body = json.dumps({"model": MODEL, "messages": history, "max_tokens": MAX_TOKENS}).encode()',
    '        request = urllib.request.Request(BASE_URL + "/chat/completions", data=body, headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"})',
    '        started = time.perf_counter()',
    '        try:',
    '            with urllib.request.urlopen(request, timeout=1800) as response: data = json.loads(response.read().decode())',
    '            elapsed = time.perf_counter() - started',
    '            answer = data["choices"][0]["message"]["content"]; usage = data.get("usage", {})',
    '            history.append({"role": "assistant", "content": answer})',
    '            print("\\nAssistant: " + answer)',
    '            print("Tokens:", usage.get("total_tokens", "n/a"), "| prompt:", usage.get("prompt_tokens", "n/a"), "| completion:", usage.get("completion_tokens", "n/a"), "| time: %.2fs\\n" % elapsed)',
    '        except urllib.error.HTTPError as error:',
    '            print("HTTP error:", error.code, error.read().decode(errors="replace")); history.pop()',
    '        except Exception as error: print("Request failed:", error); history.pop()',
    'if __name__ == "__main__": main()',
    ''
  ].join('\n');
  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="local-ii-client.py"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(script);
});

app.get('/auth/login', (req, res) => isAdmin(req) ? res.redirect('/auth/') : res.send(loginPage({ theme: selectedTheme(req) })));
app.post('/auth/login', (req, res) => {
  const ip = req.ip;
  const state = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  if (state.blockedUntil > Date.now()) return res.status(429).send(loginPage({ error: 'Слишком много попыток. Повторите через 15 минут.', theme: selectedTheme(req) }));
  const validUsername = String(req.body.username || '') === config.adminUsername;
  const validPassword = verifyPassword(req.body.password || '', config.adminPasswordHash);
  if (!validUsername || !validPassword) {
    state.count += 1;
    if (state.count >= 5) { state.blockedUntil = Date.now() + 15 * 60_000; state.count = 0; }
    loginAttempts.set(ip, state);
    return res.status(401).send(loginPage({ error: 'Неверный логин или пароль', theme: selectedTheme(req) }));
  }
  loginAttempts.delete(ip);
  const secure = isSecure(req);
  res.cookie('lai_session', signSession(config.sessionSecret), { httpOnly: true, sameSite: 'strict', secure, maxAge: 86400_000, path: '/auth' });
  res.redirect('/auth/');
});
app.get('/auth/logout', (_req, res) => { res.clearCookie('lai_session', { path: '/auth' }); res.redirect('/auth/login'); });
app.get('/auth/models', requireAdmin, async (req, res) => {
  const cookies = cookieMap(req);
  let notice = null;
  if (cookies.lai_notice) {
    res.clearCookie('lai_notice', { path: '/auth' });
    try { notice = JSON.parse(cookies.lai_notice); } catch {}
  }
  let models = [];
  let modelError = '';
  try { models = await listInstalledModels(); }
  catch (error) { modelError = 'Не удалось получить список моделей: ' + error.message; }
  res.send(modelsPage({ models, model: config.defaultModel, modelJobs: Array.from(modelJobs.values()).slice(-8).reverse(), modelError, notice, theme: selectedTheme(req) }));
});
app.get('/auth/', requireAdmin, async (req, res) => {
  const cookies = cookieMap(req);
  const newKey = cookies.lai_new_key || '';
  let notice = null;
  if (newKey) res.clearCookie('lai_new_key', { path: '/auth' });
  if (cookies.lai_notice) {
    res.clearCookie('lai_notice', { path: '/auth' });
    try { notice = JSON.parse(cookies.lai_notice); } catch { notice = null; }
  }

  res.send(dashboard({
    keys: statements.listKeys.all(),
    tokenStats: statements.tokenStats.get(),
    recent: statements.recent.all(),
    model: config.defaultModel,
    baseUrl: config.baseUrl,
    newKey,
    theme: selectedTheme(req),
    notice,
    version: serviceVersion,
    updateInfo: (() => {
      let status = null;
      try { status = JSON.parse(fs.readFileSync(path.join(config.root, 'data', 'update-status.json'), 'utf8')); } catch {}
      if (!status) return null;
      status.runtimeVersion = serviceVersion;
      status.installedVersion = serviceVersion;
      if (status.latestVersion && status.latestVersion !== serviceVersion) {
        status.state = 'available';
        status.message = 'Доступна версия ' + status.latestVersion + '. Установлена версия ' + serviceVersion + '.';
      } else if (status.state === 'current' || status.state === 'updated') {
        status.latestVersion = serviceVersion;
        status.message = 'Установлена последняя версия.';
      }
      return status;
    })()
  }));
});

app.post('/auth/models/pull', requireAdmin, (req, res) => {
  const customModel = String(req.body.customModel || '').trim();
  const model = customModel || String(req.body.modelPreset || '').trim();
  if (!model || model.length > 160 || !modelNamePattern.test(model)) {
    setAdminNotice(req, res, 'error', 'Укажите корректное имя модели, например qwen3:4b');
    return res.redirect('/auth/models');
  }
  if (modelJobs.get(model)?.status === 'loading') {
    setAdminNotice(req, res, 'warning', `Модель ${model} уже скачивается`);
    return res.redirect('/auth/models');
  }
  startModelPull(model);
  setAdminNotice(req, res, 'success', `Скачивание ${model} запущено. Обновите страницу, чтобы увидеть результат.`);
  res.redirect('/auth/models');
});

app.post('/auth/models/delete', requireAdmin, async (req, res) => {
  const model = String(req.body.model || '').trim();
  if (!model || model.length > 160 || !modelNamePattern.test(model)) {
    setAdminNotice(req, res, 'error', 'Передано некорректное имя модели');
    return res.redirect('/auth/models');
  }
  if (model === config.defaultModel) {
    setAdminNotice(req, res, 'warning', 'Активную базовую модель удалить нельзя');
    return res.redirect('/auth/models');
  }
  if (modelJobs.get(model)?.status === 'loading') {
    setAdminNotice(req, res, 'warning', 'Нельзя удалить модель во время скачивания');
    return res.redirect('/auth/models');
  }
  try {
    const upstream = await fetch(`${config.ollamaUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.error) throw new Error(result.error || `Ollama вернула код ${upstream.status}`);
    modelJobs.delete(model);
    setAdminNotice(req, res, 'success', `Модель ${model} удалена`);
  } catch (error) {
    setAdminNotice(req, res, 'error', `Не удалось удалить модель: ${error.message}`);
  }
  res.redirect('/auth/models');
});

app.post('/auth/keys', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const monthlyLimit = Math.max(0, Number.parseInt(req.body.monthlyLimit || '0', 10) || 0);
  if (!name) return res.status(400).send('Название обязательно');
  const key = createApiKey();
  statements.createKey.run(name, hashApiKey(key), key.slice(0, 12), encryptApiKey(key, config.sessionSecret), monthlyLimit);
  res.cookie('lai_new_key', key, { httpOnly: true, sameSite: 'strict', secure: isSecure(req), maxAge: 60_000, path: '/auth' });
  res.redirect('/auth/');
});

app.post('/auth/keys/:id/reveal', requireAdmin, (req, res) => {
  const record = statements.findKeyById.get(Number(req.params.id));
  if (!record) return res.status(404).send('API-ключ не найден');
  if (!record.encrypted_key) {
    return res.status(409).send('Этот ключ создан до обновления системы хранения. Его исходное значение восстановить нельзя. Создайте новый ключ.');
  }
  try {
    const key = decryptApiKey(record.encrypted_key, config.sessionSecret);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>API-ключ</title><body style="font:16px system-ui;max-width:760px;margin:48px auto;padding:0 20px"><h1>API-ключ: ${String(record.name).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}</h1><p>Не передавайте это значение третьим лицам.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#eee;color:#111;border-radius:8px">${key}</pre><p><a href="/auth/">Вернуться в панель</a></p></body></html>`);
  } catch (error) {
    console.error('[keys] Не удалось расшифровать ключ:', error.message);
    res.status(500).send('Не удалось расшифровать ключ. Проверьте sessionSecret в config.json.');
  }
});

app.post('/auth/keys/:id/rotate', requireAdmin, (req, res) => {
  const record = statements.findKeyById.get(Number(req.params.id));
  if (!record) return res.status(404).send('API-ключ не найден');
  const key = createApiKey();
  statements.rotateKey.run(hashApiKey(key), key.slice(0, 12), encryptApiKey(key, config.sessionSecret), record.id);
  res.cookie('lai_new_key', key, { httpOnly: true, sameSite: 'strict', secure: isSecure(req), maxAge: 60_000, path: '/auth' });
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
