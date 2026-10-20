'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./config');

const templates = Object.fromEntries(
  ['login', 'dashboard', 'docs'].map(name => [name, fs.readFileSync(path.join(root, 'views', `${name}.html`), 'utf8')])
);

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function render(name, values) {
  let html = templates[name];
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, String(value ?? ''));
  return html;
}

function themeData(theme, next) {
  const current = theme === 'light' ? 'light' : 'dark';
  const target = current === 'dark' ? 'light' : 'dark';
  return {
    THEME: current,
    THEME_URL: `/theme/${target}?next=${encodeURIComponent(next)}`,
    THEME_LABEL: target === 'light' ? 'Светлая тема' : 'Тёмная тема'
  };
}

function loginPage({ error = '', theme = 'dark' } = {}) {
  return render('login', {
    ...themeData(theme, '/auth/login'),
    ERROR: error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''
  });
}

function dashboard({ keys, totals, recent, model, baseUrl, newKey, theme = 'dark' }) {
  const keyRows = keys.map(key => `
    <tr>
      <td><strong>${escapeHtml(key.name)}</strong><span class="muted mono">${escapeHtml(key.prefix)}…</span></td>
      <td><span class="status ${key.enabled ? 'status-ok' : 'status-off'}">${key.enabled ? 'Активен' : 'Выключен'}</span></td>
      <td>${Number(key.month_usage || 0).toLocaleString('ru-RU')}</td>
      <td>${key.monthly_limit ? Number(key.monthly_limit).toLocaleString('ru-RU') : 'Без лимита'}</td>
      <td class="actions">
        <form method="post" action="/auth/keys/${Number(key.id)}/toggle"><button class="button button-secondary" type="submit">${key.enabled ? 'Отключить' : 'Включить'}</button></form>
        <form method="post" action="/auth/keys/${Number(key.id)}/delete"><button class="button button-danger" type="submit">Удалить</button></form>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">API-ключей пока нет</td></tr>';

  const eventRows = recent.map(event => `
    <tr>
      <td>${escapeHtml(event.key_name)}</td>
      <td class="mono">${escapeHtml(event.model)}</td>
      <td>${Number(event.total_tokens || 0).toLocaleString('ru-RU')}</td>
      <td>${Number(event.latency_ms || 0).toLocaleString('ru-RU')} мс</td>
      <td><span class="status ${Number(event.status_code) < 400 ? 'status-ok' : 'status-off'}">${Number(event.status_code)}</span></td>
      <td>${escapeHtml(new Date(event.created_at).toLocaleString('ru-RU'))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Запросов пока нет</td></tr>';

  return render('dashboard', {
    ...themeData(theme, '/auth/'),
    MODEL: escapeHtml(model), BASE_URL: escapeHtml(baseUrl),
    TOTAL_TOKENS: Number(totals.total_tokens || 0).toLocaleString('ru-RU'),
    TOTAL_REQUESTS: Number(totals.requests || 0).toLocaleString('ru-RU'),
    KEY_COUNT: keys.length, KEY_ROWS: keyRows, EVENT_ROWS: eventRows,
    NEW_KEY: newKey ? `<section class="card key-created"><h2>Новый API-ключ</h2><p>Скопируйте его сейчас. Позже полный ключ не показывается.</p><code>${escapeHtml(newKey)}</code></section>` : ''
  });
}

function docsPage({ baseUrl, model, theme = 'dark' }) {
  const curl = `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ВАШ_API_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Привет!"}]}'`;
  return render('docs', { ...themeData(theme, '/docs'), BASE_URL: escapeHtml(baseUrl), MODEL: escapeHtml(model), CURL: escapeHtml(curl) });
}

module.exports = { loginPage, dashboard, docsPage };
