module.exports = {
  apps: [
    {
      name: "ywdev-learn-x",
      cwd: __dirname,
      script: "/bin/zsh",
      args: ["-lc", "npm run build:local && exec node app/code/server.mjs"],
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      exp_backoff_restart_delay: 100,
      min_uptime: 5_000,
      max_restarts: 10,
      time: true,
      watch: ["app/code", "00_config/chatpack.config.json", "02_prompts/chatpack"],
      ignore_watch: [".git", "node_modules", "dist", "app/code/.test-tmp"],
      watch_delay: 1_000,
      env: {
        HOST: "127.0.0.1",
        PORT: "4173"
      }
    }
  ]
};
