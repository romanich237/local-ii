'use strict';

const { execFileSync } = require('node:child_process');
const { loadConfig } = require('./config');
const config = loadConfig();

const run = (command, args) => execFileSync(command, args, { cwd: config.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
let updating = false;

function check() {
  if (!config.autoUpdate || updating) return;
  updating = true;
  try {
    run('git', ['fetch', 'origin', config.repositoryBranch]);
    const local = run('git', ['rev-parse', 'HEAD']);
    const remote = run('git', ['rev-parse', `origin/${config.repositoryBranch}`]);
    if (local !== remote) {
      run('git', ['merge', '--ff-only', remote]);
      run('npm', ['ci', '--omit=dev']);
      run('pm2', ['reload', 'local-ai-api', '--update-env']);
      console.log(`[update] Установлена версия ${remote.slice(0, 7)}`);
    }
  } catch (error) { console.error(`[update] ${error.stderr || error.message}`); }
  finally { updating = false; }
}

console.log(`[update] Проверка каждые ${config.updateIntervalSeconds || 60} сек.`);
check();
setInterval(check, Math.max(30, config.updateIntervalSeconds || 60) * 1000).unref();
