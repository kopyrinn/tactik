module.exports = {
  apps: [
    {
      name: 'tactik-server',
      script: 'apps/server/dist/index.js',
      cwd: '/app',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'tactik-web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/app/apps/web',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
