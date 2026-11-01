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

function dashboard({ keys, tokenStats, recent, model, baseUrl, newKey, theme = 'dark', models = [], modelJobs = [], modelError = '', notice = null }) {
  const number = value => Number(value || 0).toLocaleString('ru-RU');
  const formatBytes = value => {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toLocaleString('ru-RU', { maximumFractionDigits: index > 2 ? 1 : 0 })} ${units[index]}`;
  };

  const modelRows = models.map(item => {
    const name = String(item.name || item.model || '');
    const active = name === model;
    const details = item.details || {};
    return `
      <tr>
        <td><strong class="mono">${escapeHtml(name)}</strong><span class="muted">${escapeHtml(details.family || 'Ollama')}</span></td>
        <td>${formatBytes(item.size)}</td>
        <td>${escapeHtml(details.parameter_size || '—')}</td>
        <td><span class="status ${active ? 'status-ok' : 'status-neutral'}">${active ? 'Базовая' : 'Установлена'}</span></td>
        <td class="actions">
          ${active
            ? '<button class="button button-danger" type="button" disabled title="Сначала измените базовую модель">Удалить</button>'
            : `<form method="post" action="/auth/models/delete"><input type="hidden" name="model" value="${escapeHtml(name)}"><button class="button button-danger" type="submit">Удалить</button></form>`}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Установленных моделей пока нет</td></tr>';

  const modelJobRows = modelJobs.map(job => `
    <div class="model-job">
      <div><strong class="mono">${escapeHtml(job.model)}</strong><span>${escapeHtml(job.message)}</span></div>
      <span class="status ${job.status === 'success' ? 'status-ok' : job.status === 'error' ? 'status-off' : 'status-loading'}">${job.status === 'success' ? 'Готово' : job.status === 'error' ? 'Ошибка' : 'Загрузка'}</span>
    </div>`).join('');

  const noticeHtml = notice?.message
    ? `<div class="alert alert-${['success', 'warning'].includes(notice.type) ? notice.type : 'error'}">${escapeHtml(notice.message)}</div>`
    : modelError
      ? `<div class="alert alert-error">${escapeHtml(modelError)}</div>`
      : '';

  const tokenBreakdown = keys.map(key => {
    const used = Number(key.month_tokens || 0);
    const limit = Number(key.monthly_limit || 0);
    const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
    const stateClass = percent >= 100 ? ' usage-item-danger' : percent >= 80 ? ' usage-item-warning' : '';
    const meter = limit > 0
      ? `<progress class="usage-progress" max="${limit}" value="${Math.min(used, limit)}" aria-label="Использовано ${percent}%"></progress>`
      : '<div class="usage-no-limit" aria-label="Лимит не установлен"></div>';
    return `
      <article class="usage-item${stateClass}">
        <div class="usage-item-head">
          <div class="usage-key"><strong>${escapeHtml(key.name)}</strong><span class="mono">${escapeHtml(key.key_prefix)}…</span></div>
          <span class="usage-percent">${limit > 0 ? `${percent}%` : 'Без лимита'}</span>
        </div>
        <div class="usage-item-values"><span>Потрачено <strong>${number(used)}</strong></span><span>${limit > 0 ? `Лимит ${number(limit)}` : 'Ограничение отключено'}</span></div>
        ${meter}
      </article>`;
  }).join('') || '<div class="usage-empty">Создайте API-ключ — здесь появится его расход токенов</div>';

  const keyRows = keys.map(key => `
    <tr>
      <td><strong>${escapeHtml(key.name)}</strong><span class="muted mono">${escapeHtml(key.key_prefix)}…</span></td>
      <td><span class="status ${key.enabled ? 'status-ok' : 'status-off'}">${key.enabled ? 'Активен' : 'Выключен'}</span></td>
      <td>${number(key.month_tokens)}</td>
      <td>${key.monthly_limit ? Number(key.monthly_limit).toLocaleString('ru-RU') : 'Без лимита'}</td>
      <td class="actions">
        ${key.can_reveal ? `<form method="post" action="/auth/keys/${Number(key.id)}/reveal"><button class="button button-secondary" type="submit">Показать</button></form>` : '<span class="muted">Старый ключ: только хэш</span>'}
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
    ALL_TOKENS: number(tokenStats.all_tokens),
    MONTH_TOKENS: number(tokenStats.month_tokens),
    TODAY_TOKENS: number(tokenStats.today_tokens),
    AVG_TOKENS: number(tokenStats.avg_tokens),
    PROMPT_TOKENS: number(tokenStats.prompt_tokens),
    COMPLETION_TOKENS: number(tokenStats.completion_tokens),
    MONTH_REQUESTS: number(tokenStats.month_requests),
    KEY_COUNT: keys.length,
    MODEL_COUNT: models.length,
    MODEL_ROWS: modelRows,
    MODEL_JOBS: modelJobRows ? `<div class="model-jobs"><h3>Последние загрузки</h3>${modelJobRows}</div>` : '',
    MODEL_NOTICE: noticeHtml,
    TOKEN_BREAKDOWN: tokenBreakdown,
    KEY_ROWS: keyRows,
    EVENT_ROWS: eventRows,
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
