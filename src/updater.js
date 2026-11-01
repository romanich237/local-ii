'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('./config');

const config = loadConfig();
const repositoryUrl = 'https://github.com/romanich237/local-ii.git';
const repositorySsh = 'git@github.com:romanich237/local-ii.git';
const branch = config.repositoryBranch || 'main';
const deployKey = '/etc/local-ii/deploy_key';
const sshKnownHosts = '/etc/local-ii/known_hosts';
const statusPath = path.join(config.root, 'data', 'update-status.json');
const requestPath = path.join(config.root, 'data', 'update-request');
let updating = false;

function run(command, args, extraEnv = {}) {
  return execFileSync(command, args, {
    cwd: config.root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    env: { ...process.env, TZ: config.timeZone || 'Europe/Moscow', GIT_TERMINAL_PROMPT: '0', ...extraEnv }
  }).trim();
}
function installedVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
}
function writeStatus(state, details = {}) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const data = {
    state,
    installedVersion: installedVersion(),
    latestVersion: details.latestVersion || installedVersion(),
    checkedAt: new Date().toISOString(),
    message: details.message || '',
    ...details
  };
  const tempPath = statusPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tempPath, statusPath);
}
function fetchRemote() {
  // Если репозиторий открыт, используем HTTPS без ключей и PAT.
  try {
    run('git', ['-c', 'credential.helper=', 'ls-remote', repositoryUrl, 'HEAD']);
    run('git', ['remote', 'set-url', 'origin', repositoryUrl]);
    try { run('git', ['config', '--local', '--unset', 'core.sshCommand']); } catch {}
    run('git', ['-c', 'credential.helper=', 'fetch', '--prune', 'origin', branch]);
    return;
  } catch {}

  if (!fs.existsSync(deployKey)) {
    throw new Error('Репозиторий недоступен по HTTPS. Для приватного репозитория настройте Deploy Key.');
  }
  const sshCommand = 'ssh -i ' + deployKey + ' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=' + sshKnownHosts;
  run('git', ['remote', 'set-url', 'origin', repositorySsh]);
  run('git', ['config', '--local', 'core.sshCommand', sshCommand]);
  run('git', ['fetch', '--prune', 'origin', branch], { GIT_SSH_COMMAND: sshCommand });
}
function restartTelegram() {
  const telegram = config.telegram || {};
  const enabled = Boolean(telegram.enabled && telegram.botToken && (telegram.adminUserId || telegram.adminChatId));
  if (!enabled) {
    try { run('pm2', ['delete', 'local-ai-telegram']); } catch {}
    return;
  }
  try {
    run('pm2', ['restart', 'local-ai-telegram', '--update-env']);
  } catch {
    run('pm2', ['start', 'src/telegram.js', '--name', 'local-ai-telegram', '--update-env']);
  }
  console.log('[update] Telegram-бот перезапущен.');
}

function check(manual = false) {
  if ((!manual && config.autoUpdate === false) || updating) return;
  updating = true;
  writeStatus('checking', { message: 'Проверяется последняя версия…' });
  try {
    fetchRemote();
    const local = run('git', ['rev-parse', 'HEAD']);
    const remote = run('git', ['rev-parse', 'origin/' + branch]);
    const remotePackage = JSON.parse(run('git', ['show', 'origin/' + branch + ':package.json']));
    const latestVersion = String(remotePackage.version || 'unknown');

    if (local === remote) {
      let requestedRuntimeVersion = null;
      try {
        const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
        requestedRuntimeVersion = request.runtimeVersion || null;
      } catch {}
      if (requestedRuntimeVersion && requestedRuntimeVersion !== installedVersion()) {
        writeStatus('updating', { latestVersion, message: 'Исходники актуальны. Перезапускается API для синхронизации версии…' });
        run('pm2', ['restart', 'local-ai-api', '--update-env']);
        restartTelegram();
        writeStatus('updated', { latestVersion, installedVersion: installedVersion(), message: 'API перезапущен. Версия синхронизирована.' });
        console.log('[update] API перезапущен для синхронизации runtime-версии.');
      } else {
        writeStatus('current', { latestVersion, installedVersion: installedVersion(), message: 'Установлена последняя версия.' });
        console.log('[update] Установлена актуальная версия ' + latestVersion);
      }
      return;
    }

    writeStatus('updating', { latestVersion, message: 'Найдена новая версия. Выполняется установка…' });
    run('git', ['merge', '--ff-only', remote]);
    if (fs.existsSync(path.join(config.root, 'package-lock.json'))) {
      run('npm', ['ci', '--omit=dev']);
    } else {
      run('npm', ['install', '--omit=dev', '--no-package-lock']);
    }
    writeStatus('updated', { latestVersion, installedVersion: installedVersion(), message: 'Обновление установлено.' });
    run('pm2', ['startOrReload', 'ecosystem.config.cjs', '--update-env']);
    // startOrReload applies the ecosystem, then explicitly reload the bot to ensure
    // it runs the exact same release as the API and updater.
    restartTelegram();
    run('pm2', ['save']);
    console.log('[update] Установлена версия ' + installedVersion());
  } catch (error) {
    const detail = String(error.stderr || error.message || 'Неизвестная ошибка').slice(0, 1200);
    writeStatus('error', { message: 'Не удалось проверить или установить обновление: ' + detail });
    console.error('[update] Ошибка обновления:', detail);
  } finally {
    updating = false;
    try { fs.rmSync(requestPath, { force: true }); } catch {}
  }
}

console.log('[update] Репозиторий romanich237/local-ii, ветка ' + branch + '; проверка каждые ' + (config.updateIntervalSeconds || 60) + ' сек.');
check(false);
setInterval(() => {
  if (fs.existsSync(requestPath)) check(true);
}, 2000);
setInterval(() => check(false), Math.max(30, config.updateIntervalSeconds || 60) * 1000);
