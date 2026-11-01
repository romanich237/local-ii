'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config.json');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error('Не найден config.json. Запустите sudo bash install.sh');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let migrated = false;
  if (!config.baseUrl && config.domain) {
    config.baseUrl = `https://${config.domain}/v1`;
    migrated = true;
  }
  if (!config.adminUsername) {
    config.adminUsername = 'administrator';
    migrated = true;
  }
  if (!config.telegram) {
    config.telegram = { enabled: false, botToken: '', adminChatId: '' };
    migrated = true;
  }
  if (migrated) fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  for (const field of ['port', 'domain', 'baseUrl', 'ollamaUrl', 'defaultModel', 'adminUsername', 'adminPasswordHash', 'sessionSecret']) {
    if (!config[field]) throw new Error(`В config.json отсутствует поле ${field}`);
  }
  return { ...config, root, configPath };
}

module.exports = { loadConfig, root, configPath };
