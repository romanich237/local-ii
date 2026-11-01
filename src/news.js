'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHANNEL = 'localiirom';
const CHANNEL_URL = 'https://t.me/s/' + CHANNEL;
const POLL_INTERVAL = 3 * 60 * 1000;

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractPosts(html) {
  const posts = [];
  const blocks = html.match(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/g) || [];
  for (const block of blocks) {
    const id = block.match(/data-post="(?:[^"]+\/)?(\d+)"/)?.[1];
    if (!id) continue;
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const content = decodeHtml(textMatch?.[1] || '');
    const url = 'https://t.me/' + CHANNEL + '/' + id;
    const date = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1] || null;
    const photo = block.match(/background-image:url\('(https:\/\/[^']+)'\)/)?.[1] || null;
    posts.push({ id: Number(id), text: content || 'Опубликована новая запись в канале.', url, date, photo });
  }
  return posts.sort((a, b) => a.id - b.id);
}

function createNewsService(config) {
  const file = path.join(config.root, 'data', 'channel-news.json');
  let items = [];
  let latestId = 0;
  let initialized = false;
  let timer = null;

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Array.isArray(saved.items) ? saved.items.slice(0, 30) : [];
      latestId = Number(saved.latestId) || 0;
      initialized = latestId > 0;
    } catch {}
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ latestId, items }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  async function notify(post) {
    const telegram = config.telegram || {};
    const admin = String(telegram.adminUserId || telegram.adminChatId || '');
    if (!telegram.enabled || !telegram.botToken || !admin) return;
    const message = 'Новости Local AI Server\n\n' + post.text.slice(0, 3000) + '\n\n' + post.url;
    try {
      const response = await fetch('https://api.telegram.org/bot' + telegram.botToken + '/sendMessage', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: admin, text: message, disable_web_page_preview: false }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error('Telegram HTTP ' + response.status);
      const result = await response.json();
      if (!result.ok) throw new Error(result.description || 'Telegram API error');
    } catch (error) {
      console.error('[news] Не удалось отправить уведомление в Telegram:', error.message);
    }
  }
  async function poll() {
    try {
      const response = await fetch(CHANNEL_URL, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LocalAIServer/1.0)' },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error('Channel HTTP ' + response.status);
      const html = await response.text();
      const posts = extractPosts(html);
      if (!posts.length) throw new Error('Не удалось разобрать публикации канала');
      const newest = posts[posts.length - 1].id;
      if (!initialized) {
        latestId = newest;
        initialized = true;
        items = posts.slice(-20).reverse();
        save();
        console.log('[news] Лента канала подключена. Последняя запись #' + newest);
        return;
      }
      const fresh = posts.filter(post => post.id > latestId);
      if (!fresh.length) return;
      for (const post of fresh) {
        items.unshift(post);
        await notify(post);
      }
      items = items.slice(0, 30);
      latestId = Math.max(latestId, newest);
      save();
      console.log('[news] Получено новых публикаций: ' + fresh.length);
    } catch (error) {
      console.error('[news] Ошибка проверки канала:', error.message);
    }
  }

  load();
  return {
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, POLL_INTERVAL);
      if (typeof timer.unref === 'function') timer.unref();
    },
    list() { return items.slice(0, 20); },
    channelUrl: CHANNEL_URL
  };
}

module.exports = { createNewsService, extractPosts };
