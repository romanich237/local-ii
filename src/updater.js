'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('./config');

const config = loadConfig();
const repository = 'git@github.com:romanich237/local-ii.git';
const branch = config.repositoryBranch || 'main';
const deployKey = '/etc/local-ii/deploy_key';
const sshKnownHosts = '/etc/local-ii/known_hosts';

function run(command, args, extraEnv = {}) {
  return execFileSync(command, args, {
    cwd: config.root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv }
  }).trim();
}

let updating = false;

function check() {
  if (config.autoUpdate === false || updating) return;
  updating = true;
  try {
    const hasDeployKey = fs.existsSync(deployKey);
    if (hasDeployKey) {
      const sshCommand = `ssh -i ${deployKey} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${sshKnownHosts}`;
      run('git', ['remote', 'set-url', 'origin', repository]);
      run('git', ['config', '--local', 'core.sshCommand', sshCommand]);
      run('git', ['fetch', '--prune', 'origin', branch], { GIT_SSH_COMMAND: sshCommand });
    } else {
      // Публичный репозиторий доступен по HTTPS без PAT и без авторизации GitHub-профилем.
      run('git', ['remote', 'set-url', 'origin', 'https://github.com/romanich237/local-ii.git']);
      run('git', ['config', '--local', '--unset', 'credential.helper']);
      run('git', ['fetch', '--prune', 'origin', branch]);
    }

    const local = run('git', ['rev-parse', 'HEAD']);
    const remote = run('git', ['rev-parse', `origin/${branch}`]);
    if (local === remote) {
      console.log(`[update] Уже установлена актуальная версия ${local.slice(0, 7)}`);
      return;
    }

    run('git', ['merge', '--ff-only', remote]);
    run('npm', ['ci', '--omit=dev']);
    run('pm2', ['reload', 'local-ai-api', '--update-env']);
    console.log(`[update] Установлена версия ${remote.slice(0, 7)}`);
  } catch (error) {
    const detail = error.stderr || error.message;
    console.error(`[update] Обновление не выполнено: ${detail}`);
  } finally {
    updating = false;
  }
}

console.log(`[update] Репозиторий romanich237/local-ii, ветка ${branch}; проверка каждые ${config.updateIntervalSeconds || 60} сек.`);
check();
setInterval(check, Math.max(30, config.updateIntervalSeconds || 60) * 1000).unref();
