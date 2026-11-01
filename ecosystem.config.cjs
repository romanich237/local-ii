'use strict';

const fs = require('node:fs');
const path = require('node:path');
let telegramEnabled = false;
try {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  telegramEnabled = Boolean(config.telegram?.enabled && config.telegram?.botToken && (config.telegram?.adminUserId || config.telegram?.adminChatId));
} catch {}

const commonEnv = { NODE_ENV: 'production', TZ: 'Europe/Moscow' };
const apps = [
  {
    name: 'local-ai-api',
    script: 'src/server.js',
    cwd: __dirname,
    autorestart: true,
    max_memory_restart: '1G',
    env: commonEnv
  },
  {
    name: 'local-ai-updater',
    script: 'src/updater.js',
    cwd: __dirname,
    autorestart: true,
    max_memory_restart: '256M',
    env: commonEnv
  }
];
if (telegramEnabled) {
  apps.push({
    name: 'local-ai-telegram',
    script: 'src/telegram.js',
    cwd: __dirname,
    autorestart: true,
    max_memory_restart: '128M',
    env: commonEnv
  });
}
module.exports = { apps };
