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
  for (const field of ['port', 'ollamaUrl', 'defaultModel', 'adminPasswordHash', 'sessionSecret']) {
    if (!config[field]) throw new Error(`В config.json отсутствует поле ${field}`);
  }
  return { ...config, root, configPath };
}

module.exports = { loadConfig, root, configPath };
