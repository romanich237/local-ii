'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./config');

const templates = Object.fromEntries(
  ['login', 'dashboard', 'models', 'docs'].map(name => [name, fs.readFileSync(path.join(__dirname, '..', 'public', 'html', name + '.html'), 'utf8')])
);

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function render(name, values) {
  let html = templates[name];
  for (const [key, value] of Object.entries(values)) html = html.replaceAll('{{' + key + '}}', String(value ?? ''));
  return html;
}
function themeData(theme, next) {
  const current = theme === 'light' ? 'light' : 'dark';
  const target = current === 'dark' ? 'light' : 'dark';
  return { THEME: current, THEME_URL: '/theme/' + target + '?next=' + encodeURIComponent(next), THEME_LABEL: target === 'light' ? 'Светлая тема' : 'Тёмная тема' };
}
function loginPage({ error = '', theme = 'dark' } = {}) {
  return render('login', { ...themeData(theme, '/auth/login'), ERROR: error ? '<div class="alert alert-error">' + escapeHtml(error) + '</div>' : '' });
}

const modelCatalog = [
  { group: 'Компактные', tag: 'qwen3:4b', name: 'Qwen 3 4B', note: 'Быстрые повседневные задачи', ram: 'от 8 ГБ RAM', recommended: true },
  { group: 'Компактные', tag: 'gemma3:4b', name: 'Gemma 3 4B', note: 'Текст и изображения', ram: 'от 8 ГБ RAM' },
  { group: 'Компактные', tag: 'llama3.2:3b', name: 'Llama 3.2 3B', note: 'Лёгкий универсальный вариант', ram: 'от 6 ГБ RAM' },
  { group: 'Универсальные', tag: 'qwen3:8b', name: 'Qwen 3 8B', note: 'Баланс качества и скорости', ram: 'от 16 ГБ RAM', recommended: true },
  { group: 'Универсальные', tag: 'qwen3:14b', name: 'Qwen 3 14B', note: 'Более сложные задачи', ram: 'от 24 ГБ RAM' },
  { group: 'Рассуждения', tag: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', note: 'Логика и пошаговый анализ', ram: 'от 16 ГБ RAM' },
  { group: 'Программирование', tag: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', note: 'Код, отладка и объяснения', ram: 'от 16 ГБ RAM', recommended: true },
  { group: 'Программирование', tag: 'devstral:24b', name: 'Devstral 24B', note: 'Агентные задачи разработки', ram: 'от 32 ГБ RAM' },
  { group: 'Мультимодальные', tag: 'llama3.2-vision:11b', name: 'Llama 3.2 Vision 11B', note: 'Изображения и текст', ram: 'от 24 ГБ RAM' },
  { group: 'Мультимодальные', tag: 'gemma3:12b', name: 'Gemma 3 12B', note: 'Текст и изображения', ram: 'от 24 ГБ RAM' }
];

function dashboard({ keys = [], tokenStats = {}, recent = [], baseUrl, newKey, theme = 'dark', version = 'unknown', updateInfo = null, telegramSettings = {} }) {
  const number = value => Number(value || 0).toLocaleString('ru-RU');
  const tokenBreakdown = keys.map(key => {
    const used = Number(key.month_tokens || 0), limit = Number(key.monthly_limit || 0);
    const percent = limit > 0 ? Math.round(used / limit * 100) : 0;
    const meter = limit > 0 ? '<progress class="usage-progress" max="' + limit + '" value="' + Math.min(used, limit) + '"></progress>' : '<div class="usage-no-limit"></div>';
    return '<article class="usage-item"><div class="usage-item-head"><div class="usage-key"><strong>' + escapeHtml(key.name) + '</strong><span class="mono">' + escapeHtml(key.key_prefix) + '…</span></div><span class="usage-percent">' + (limit > 0 ? percent + '%' : 'Без лимита') + '</span></div><div class="usage-item-values"><span>Потрачено <strong>' + number(used) + '</strong></span><span>' + (limit > 0 ? 'Лимит ' + number(limit) : 'Ограничение отключено') + '</span></div>' + meter + '</article>';
  }).join('') || '<div class="usage-empty">Создайте API-ключ — здесь появится расход токенов</div>';
  const keyRows = keys.map(key => {
    const id = Number(key.id);
    const reveal = key.can_reveal
      ? '<form method="post" action="/auth/keys/' + id + '/reveal"><button class="button button-secondary" type="submit">Показать</button></form>'
      : '<form class="key-rotate-form" method="post" action="/auth/keys/' + id + '/rotate"><button class="button button-secondary" type="submit">Перевыпустить</button></form>';
    return '<tr><td><strong>' + escapeHtml(key.name) + '</strong><span class="muted mono">' + escapeHtml(key.key_prefix) + '…</span></td><td><span class="status ' + (key.enabled ? 'status-ok' : 'status-off') + '">' + (key.enabled ? 'Активен' : 'Выключен') + '</span></td><td>' + number(key.month_tokens) + '</td><td>' + (key.monthly_limit ? number(key.monthly_limit) : 'Без лимита') + '</td><td class="actions">' + reveal + '<form method="post" action="/auth/keys/' + id + '/toggle"><button class="button button-secondary" type="submit">' + (key.enabled ? 'Отключить' : 'Включить') + '</button></form><form method="post" action="/auth/keys/' + id + '/delete"><button class="button button-danger" type="submit">Удалить</button></form></td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">API-ключей пока нет</td></tr>';
  const eventRows = recent.map(event => '<tr><td><span class="status ' + (event.source === 'Чат' ? 'status-neutral' : 'status-ok') + '">' + escapeHtml(event.source || 'API') + '</span></td><td>' + escapeHtml(event.key_name) + '</td><td class="mono">' + escapeHtml(event.model) + '</td><td>' + number(event.total_tokens) + '</td><td>' + (Number(event.latency_ms || 0) / 1000).toFixed(2) + ' с</td><td><span class="status ' + (Number(event.status_code) < 400 ? 'status-ok' : 'status-off') + '">' + Number(event.status_code) + '</span></td><td>' + escapeHtml(new Date(event.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })) + '</td></tr>').join('') || '<tr><td colspan="7" class="empty">Запросов пока нет</td></tr>';
  const updateStateLabels = { idle: 'Ожидает проверки', available: 'Доступно обновление', checking: 'Проверка…', updating: 'Установка обновления…', current: 'Установлена последняя версия', updated: 'Обновление установлено', error: 'Ошибка проверки' };
  const updateState = updateInfo?.state || 'idle';
  const updateMessage = updateInfo?.message || 'Нажмите кнопку, чтобы проверить наличие новой версии.';
  const updateChecked = updateInfo?.checkedAt ? new Date(updateInfo.checkedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Ещё не проверялось';
  return render('dashboard', {
    ...themeData(theme, '/auth/'), BASE_URL: escapeHtml(baseUrl),
    ALL_TOKENS: number(tokenStats.all_tokens), MONTH_TOKENS: number(tokenStats.month_tokens),
    TODAY_TOKENS: number(tokenStats.today_tokens), AVG_TOKENS: number(tokenStats.avg_tokens),
    PROMPT_TOKENS: number(tokenStats.prompt_tokens), COMPLETION_TOKENS: number(tokenStats.completion_tokens),
    MONTH_REQUESTS: number(tokenStats.month_requests), KEY_COUNT: keys.length,
    TOKEN_BREAKDOWN: tokenBreakdown, KEY_ROWS: keyRows, EVENT_ROWS: eventRows,
    SERVICE_VERSION: escapeHtml(version),
    TELEGRAM_ENABLED: telegramSettings.enabled ? 'checked' : '',
    TELEGRAM_ADMIN_ID: escapeHtml(telegramSettings.adminUserId || ''),
    TELEGRAM_BOT_STATUS: telegramSettings.enabled ? 'Подключён' : 'Отключён',
    UPDATE_STATE: escapeHtml(updateStateLabels[updateState] || updateState),
    UPDATE_MESSAGE: escapeHtml(updateMessage), UPDATE_CHECKED: escapeHtml(updateChecked),
    UPDATE_LATEST: escapeHtml(updateInfo?.latestVersion || version), UPDATE_STATE_CODE: escapeHtml(updateState),
    SERVER_STATUS: '<div class="resource-gauges"><article class="resource-gauge"><div class="gauge-ring" data-gauge="cpu" style="--gauge-value:0"><span data-gauge-text>0%</span></div><strong>CPU</strong></article><article class="resource-gauge"><div class="gauge-ring" data-gauge="memory" style="--gauge-value:0"><span data-gauge-text>0%</span></div><strong>Память</strong><small data-gauge-detail="memory">—</small></article><article class="resource-gauge"><div class="gauge-ring" data-gauge="disk" style="--gauge-value:0"><span data-gauge-text>0%</span></div><strong>Жёсткий диск</strong><small data-gauge-detail="disk">—</small></article></div><div class="server-status-grid"><div class="status-cell"><span>Состояние</span><strong data-server-status>Проверка…</strong></div><div class="status-cell"><span>Версия</span><strong data-server-version>—</strong></div><div class="status-cell"><span>Операционная система</span><strong data-server-platform>—</strong></div><div class="status-cell"><span>Процессор</span><strong data-server-cpu>—</strong></div><div class="status-cell"><span>Время работы</span><strong data-server-uptime>—</strong></div><div class="status-cell"><span>Модели Ollama</span><strong data-server-models>—</strong></div><div class="status-cell"><span>Telegram-бот</span><strong data-server-telegram>—</strong></div><div class="status-cell"><span>Часовой пояс</span><strong data-server-timezone>—</strong></div></div>',
    NEW_KEY: newKey ? '<section class="card key-created"><h2>Новый API-ключ</h2><p>Сохраните его в менеджере паролей. Значение также можно посмотреть в списке ключей.</p><code>' + escapeHtml(newKey) + '</code></section>' : ''
  });
}
const mediaModelCatalog = [
  { group: 'Генерация изображений', name: 'Qwen-Image-2.1', tag: 'Qwen/Qwen-Image-2.1', mode: 'Локально · Diffusers / ComfyUI', note: 'Открытые веса. Генерация изображений, редактирование, прозрачный RGBA и до 10 референсов.', link: 'https://github.com/QwenLM/Qwen-Image-2.1', recommended: true },
  { group: 'Генерация изображений', name: 'Qwen-Image-2.1 Pro', tag: 'qwen-image-2.1-pro', mode: 'Облачный API · QwenCloud', note: 'Генерация и редактирование через API, поддержка прозрачного фона и референсных изображений.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/image-models', recommended: true },
  { group: 'Генерация изображений', name: 'Qwen-Image-2.1 Turbo', tag: 'qwen-image-2.1-turbo', mode: 'Облачный API · QwenCloud', note: 'Ускоренная генерация и редактирование; Turbo использует 8 шагов денойзинга.', link: 'https://github.com/QwenLM/Qwen-Image-2.1' },
  { group: 'Генерация изображений', name: 'Qwen-Image-3.0 Pro', tag: 'qwen-image-3.0-pro', mode: 'Облачный API · QwenCloud', note: 'Сложные композиции, макеты и точная отрисовка текста; вывод до 2K.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/image-models' },
  { group: 'Генерация изображений', name: 'Qwen-Image-3.0', tag: 'qwen-image-3.0', mode: 'Облачный API · QwenCloud', note: 'Универсальная генерация и редактирование изображений с балансом скорости и качества.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/image-models' },
  { group: 'Генерация видео', name: 'Wan 2.7 Text-to-Video', tag: 'wan2.7-t2v', mode: 'Облачный API · QwenCloud', note: 'Создание видео по тексту, синхронизация аудио и многосценовые ролики; 720p/1080p, 2–15 секунд.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models', recommended: true },
  { group: 'Генерация видео', name: 'Wan 2.7 Image-to-Video', tag: 'wan2.7-i2v', mode: 'Облачный API · QwenCloud', note: 'Анимация исходного изображения, первый и последний кадр, продолжение видео; 720p/1080p.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models', recommended: true },
  { group: 'Генерация видео', name: 'Wan 2.7 Reference-to-Video', tag: 'wan2.7-r2v-2026-06-12', mode: 'Облачный API · QwenCloud', note: 'Видео с использованием нескольких персонажей и визуальных референсов.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models' },
  { group: 'Генерация видео', name: 'Wan 2.7 Video Edit', tag: 'wan2.7-videoedit', mode: 'Облачный API · QwenCloud', note: 'Редактирование видео по текстовым инструкциям и перенос визуальных эффектов.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models' },
  { group: 'Генерация видео', name: 'Wan 3.0 Video', tag: 'wan3.0-video', mode: 'Облачный API · доступ по приглашению', note: 'Единая модель text-to-video, image-to-video и генерации по референсам; до 30 секунд, 1080p.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models' },
  { group: 'Генерация видео', name: 'HappyHorse 1.1 Text-to-Video', tag: 'happyhorse-1.1-t2v', mode: 'Облачный API · QwenCloud', note: 'Видео по текстовому описанию со звуком; 720p/1080p, 3–15 секунд.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models' },
  { group: 'Генерация видео', name: 'HappyHorse 1.1 Image-to-Video', tag: 'happyhorse-1.1-i2v', mode: 'Облачный API · QwenCloud', note: 'Оживление изображения с генерацией движения и звука; 720p/1080p, 3–15 секунд.', link: 'https://docs.qwencloud.com/developer-guides/getting-started/video-models' }
];

function modelsPage({ models = [], model, modelJobs = [], modelError = '', notice = null, theme = 'dark' }) {
  const formatBytes = value => {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / (1024 ** index)).toLocaleString('ru-RU', { maximumFractionDigits: index > 2 ? 1 : 0 }) + ' ' + units[index];
  };
  const modelRows = models.map(item => {
    const name = String(item.name || item.model || '');
    const active = name === model;
    const details = item.details || {};
    return '<tr><td><strong class="mono">' + escapeHtml(name) + '</strong><span class="muted">' + escapeHtml(details.family || 'Ollama') + '</span></td><td>' + formatBytes(item.size) + '</td><td>' + escapeHtml(details.parameter_size || '—') + '</td><td><span class="status ' + (active ? 'status-ok' : 'status-neutral') + '">' + (active ? 'Базовая' : 'Установлена') + '</span></td><td class="actions">' + (active ? '<span class="muted">Активная модель</span>' : '<form method="post" action="/auth/models/delete"><input type="hidden" name="model" value="' + escapeHtml(name) + '"><button class="button button-danger" type="submit">Удалить</button></form>') + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">Установленных моделей пока нет</td></tr>';
  const modelJobRows = modelJobs.map(job => '<div class="model-job"><div><strong class="mono">' + escapeHtml(job.model) + '</strong><span>' + escapeHtml(job.message) + '</span></div><span class="status ' + (job.status === 'success' ? 'status-ok' : job.status === 'error' ? 'status-off' : 'status-loading') + '">' + (job.status === 'success' ? 'Готово' : job.status === 'error' ? 'Ошибка' : 'Загрузка') + '</span></div>').join('');
  const noticeHtml = notice?.message ? '<div class="alert alert-' + (['success', 'warning'].includes(notice.type) ? notice.type : 'error') + '">' + escapeHtml(notice.message) + '</div>' : modelError ? '<div class="alert alert-error">' + escapeHtml(modelError) + '</div>' : '';
  const mediaCatalogCards = mediaModelCatalog.map(item => '<article class="catalog-item media-model-item"><div class="catalog-item-head"><span class="catalog-group">' + escapeHtml(item.group) + '</span>' + (item.recommended ? '<span class="status status-ok">Рекомендуем</span>' : '') + '</div><h3>' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.note) + '</p><div class="catalog-meta"><code>' + escapeHtml(item.tag) + '</code><span>' + escapeHtml(item.mode) + '</span></div><div class="media-model-actions"><button class="button button-secondary" type="button" data-copy-model="' + escapeHtml(item.tag) + '">Копировать ID</button><a class="button button-secondary" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">Документация</a></div></article>').join('');
  const catalogCards = modelCatalog.map(item => '<article class="catalog-item"><div class="catalog-item-head"><span class="catalog-group">' + escapeHtml(item.group) + '</span>' + (item.recommended ? '<span class="status status-ok">Рекомендация</span>' : '') + '</div><h3>' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.note) + '</p><div class="catalog-meta"><code>' + escapeHtml(item.tag) + '</code><span>' + escapeHtml(item.ram) + '</span></div><form method="post" action="/auth/models/pull"><input type="hidden" name="modelPreset" value="' + escapeHtml(item.tag) + '"><button class="button button-secondary" type="submit">Установить</button></form></article>').join('');
  return render('models', {
    ...themeData(theme, '/auth/models'),
    MODEL_COUNT: models.length,
    MODEL_NOTICE: noticeHtml,
    MODEL_CATALOG: catalogCards,
    MEDIA_MODEL_CATALOG: mediaCatalogCards,
    MODEL_JOBS: modelJobRows ? '<div class="model-jobs"><h3>Последние загрузки</h3>' + modelJobRows + '</div>' : '',
    MODEL_ROWS: modelRows
  });
}
function docsPage({ baseUrl, model, theme = 'dark' }) {
  const curl = 'curl ' + baseUrl + '/chat/completions \\\n  -H "Authorization: Bearer ВАШ_API_КЛЮЧ" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"' + model + '","messages":[{"role":"user","content":"Привет!"}]}\'';
  return render('docs', { ...themeData(theme, '/docs'), BASE_URL: escapeHtml(baseUrl), MODEL: escapeHtml(model), CURL: escapeHtml(curl) });
}
module.exports = { loginPage, dashboard, modelsPage, docsPage };
