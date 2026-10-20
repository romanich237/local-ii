module.exports = {
  apps: [
    {
      name: 'local-ai-api',
      script: 'src/server.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'local-ai-updater',
      script: 'src/updater.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
