'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashPassword } = require('../src/security');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config.json');
const tempPath = configPath + '.tmp';

function main() {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('Запустите команду от пользователя, которому принадлежит PM2 (обычно root).');
  }
  if (!fs.existsSync(configPath)) throw new Error('Не найден config.json в ' + root);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.adminUsername) throw new Error('В config.json не задан adminUsername.');

  const password = require('node:crypto').randomBytes(18).toString('base64url');
  config.adminPasswordHash = hashPassword(password);
  config.adminSessionSecret = require('node:crypto').randomBytes(48).toString('base64url');

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, configPath);
  fs.chmodSync(configPath, 0o600);

  console.log('');
  console.log('Новый пароль администратора создан.');
  console.log('Логин: ' + config.adminUsername);
  console.log('Пароль: ' + password);
  console.log('');
  console.log('Сохраните пароль в надёжном месте. Повторно показать его нельзя.');

  try {
    execFileSync('pm2', ['restart', 'local-ai-api', '--update-env'], { cwd: root, stdio: 'inherit' });
    console.log('API перезапущен. Новый пароль уже действует.');
  } catch (error) {
    console.error('Пароль обновлён в config.json, но API не удалось перезапустить автоматически.');
    console.error('Выполните вручную: pm2 restart local-ai-api --update-env');
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  try { fs.rmSync(tempPath, { force: true }); } catch {}
  console.error('Ошибка сброса пароля: ' + error.message);
  process.exitCode = 1;
}
