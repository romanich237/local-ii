'use strict';

const { loadConfig } = require('./config');
const { statements } = require('./db');
const { createApiKey, hashApiKey, encryptApiKey, decryptApiKey } = require('./security');

const config = loadConfig();
const telegram = config.telegram || {};
if (!telegram.enabled || !telegram.botToken || !telegram.adminChatId) {
  console.log('[telegram] Управление через Telegram отключено в config.json');
  process.exit(0);
}

const api = 'https://api.telegram.org/bot' + telegram.botToken;
const adminChatId = String(telegram.adminChatId);
const chats = new Map();
let offset = 0;

async function telegramCall(method, payload = {}) {
  const response = await fetch(api + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(40_000)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || 'Telegram API error');
  return data.result;
}
async function send(text) {
  const safeText = String(text).slice(0, 3900);
  return telegramCall('sendMessage', { chat_id: adminChatId, text: safeText, disable_web_page_preview: true });
}
function state() {
  if (!chats.has(adminChatId)) chats.set(adminChatId, {
    active: false, model: config.defaultModel,
    systemPrompt: 'Отвечай на русском языке. Будь точным и структурированным.',
    maxTokens: 1024, history: []
  });
  return chats.get(adminChatId);
}
function help() {
  return [
    'Local AI Server — управление',
    '',
    '/keys — список API-ключей',
    '/newkey название [лимит] — создать ключ',
    '/reveal ID — показать полный ключ',
    '/on ID и /off ID — включить или отключить',
    '/delete ID — удалить ключ',
    '/chat — начать диалог с моделью',
    '/stop — завершить режим чата',
    '/clear — очистить историю диалога',
    '/model тег — выбрать модель',
    '/system текст — задать системный промт',
    '/max число — максимум выходных токенов',
    '/status — состояние Ollama и модели'
  ].join('\n');
}
async function showKeys() {
  const keys = statements.listKeys.all();
  if (!keys.length) return send('API-ключей пока нет. Создать: /newkey название');
  const lines = ['API-ключи:'];
  for (const key of keys) {
    lines.push(
      '#' + key.id + ' · ' + key.name + ' · ' + (key.enabled ? 'активен' : 'отключён'),
      '  ' + key.key_prefix + '… · ' + Number(key.month_tokens).toLocaleString('ru-RU') + ' токенов за месяц'
    );
  }
  lines.push('', 'Полный ключ: /reveal ID');
  return send(lines.join('\n'));
}
async function createKeyFromCommand(args) {
  const match = args.match(/^(.+?)(?:\s+(\d+))?$/);
  if (!match) return send('Формат: /newkey название [месячный_лимит]');
  const name = match[1].trim().slice(0, 60);
  const limit = Math.max(0, Number.parseInt(match[2] || '0', 10) || 0);
  if (!name) return send('Укажите название ключа.');
  const key = createApiKey();
  const result = statements.createKey.run(name, hashApiKey(key), key.slice(0, 12), encryptApiKey(key, config.sessionSecret), limit);
  return send('Создан ключ #' + result.lastInsertRowid + ' (' + name + '):\n\n' + key + '\n\nСохраните его. Повторно показать: /reveal ' + result.lastInsertRowid);
}
async function chatWithModel(text, session) {
  session.history.push({ role: 'user', content: text });
  session.history = session.history.slice(-20);
  const started = Date.now();
  try {
    const response = await fetch(config.ollamaUrl + '/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: session.model,
        messages: [...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []), ...session.history],
        max_tokens: session.maxTokens, stream: false
      }),
      signal: AbortSignal.timeout(30 * 60 * 1000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || result.error || 'Ollama HTTP ' + response.status);
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== 'string') throw new Error('Модель вернула пустой ответ');
    session.history.push({ role: 'assistant', content: answer });
    const promptTokens = Number(result.usage?.prompt_tokens || 0);
    const completionTokens = Number(result.usage?.completion_tokens || 0);
    const totalTokens = Number(result.usage?.total_tokens || promptTokens + completionTokens);
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    return send(answer + '\n\nТокены: ' + totalTokens + ' (вход ' + promptTokens + ', выход ' + completionTokens + ') · ' + elapsed + ' с');
  } catch (error) {
    session.history.pop();
    return send('Ошибка генерации: ' + error.message);
  }
}
async function handleMessage(message) {
  if (!message?.text || message.chat?.type !== 'private' || String(message.chat.id) !== adminChatId || String(message.from?.id) !== adminChatId) return;
  const text = message.text.trim();
  const command = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  const name = command?.[1]?.toLowerCase();
  const args = command?.[2] || '';
  const session = state();

  if (name === 'start' || name === 'help') return send(help());
  if (name === 'keys') return showKeys();
  if (name === 'newkey') return createKeyFromCommand(args);
  if (name === 'reveal') {
    const keyId = Number.parseInt(args, 10);
    const record = statements.findKeyById.get(keyId);
    if (!record) return send('Ключ не найден.');
    if (!record.encrypted_key) return send('Старый ключ хранится только как хэш. Его нельзя восстановить.');
    return send('Ключ #' + keyId + ' (' + record.name + '):\n\n' + decryptApiKey(record.encrypted_key, config.sessionSecret));
  }
  if (name === 'on' || name === 'off') {
    const keyId = Number.parseInt(args, 10);
    const key = statements.listKeys.all().find(item => item.id === keyId);
    if (!key) return send('Ключ не найден.');
    statements.toggleKey.run(name === 'on' ? 1 : 0, keyId);
    return send('Ключ #' + keyId + (name === 'on' ? ' включён.' : ' отключён.'));
  }
  if (name === 'delete') {
    const keyId = Number.parseInt(args, 10);
    if (!statements.findKeyById.get(keyId)) return send('Ключ не найден.');
    statements.deleteKey.run(keyId);
    return send('Ключ #' + keyId + ' удалён.');
  }
  if (name === 'model') {
    if (!/^[a-zA-Z0-9._/-]+(?::[a-zA-Z0-9._-]+)?$/.test(args)) return send('Укажите тег, например /model qwen3:8b');
    session.model = args;
    return send('Модель чата: ' + session.model);
  }
  if (name === 'system') {
    session.systemPrompt = args.slice(0, 12000);
    return send('Системный промт обновлён (' + session.systemPrompt.length + ' символов).');
  }
  if (name === 'max') {
    const value = Number.parseInt(args, 10);
    if (!Number.isInteger(value) || value < 1 || value > 32768) return send('Укажите число от 1 до 32768.');
    session.maxTokens = value;
    return send('Максимум выходных токенов: ' + value);
  }
  if (name === 'chat') {
    session.active = true;
    return send('Режим чата включён. Модель: ' + session.model + '. Лимит: ' + session.maxTokens + ' токенов. Для выхода отправьте /stop.');
  }
  if (name === 'stop') { session.active = false; return send('Режим чата выключен.'); }
  if (name === 'clear') { session.history = []; return send('История диалога очищена.'); }
  if (name === 'status') {
    try {
      const response = await fetch(config.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(3000) });
      const result = await response.json();
      return send('Ollama: ' + (response.ok ? 'доступна' : 'ошибка') + '\nМоделей: ' + (result.models?.length || 0) + '\nМодель чата: ' + session.model);
    } catch (error) { return send('Ollama недоступна: ' + error.message); }
  }
  if (session.active && !text.startsWith('/')) return chatWithModel(text, session);
  return send(help());
}

async function poll() {
  while (true) {
    try {
      const updates = await telegramCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        try { await handleMessage(update.message); }
        catch (error) { console.error('[telegram] Ошибка команды:', error.message); await send('Ошибка команды: ' + error.message).catch(() => {}); }
      }
    } catch (error) {
      console.error('[telegram] Ошибка polling:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}
telegramCall('getMe').then(bot => {
  console.log('[telegram] Бот @' + bot.username + ' запущен. Разрешённый администратор: ' + adminChatId);
  return poll();
}).catch(error => {
  console.error('[telegram] Не удалось запустить бота:', error.message);
  process.exitCode = 1;
});
