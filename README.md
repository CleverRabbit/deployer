# Deployer & Monitor

Lightweight deployment and monitoring system for Docker projects.

## Features
- **Auth**: Token-based activation via email.
- **Git Integration**: Clone projects with SSH passphrase support (RAM only).
- **Docker Deploy**: One-click deploy/stop via `docker compose`.
- **Monitoring**: Real-time CPU/RAM tracking with Chart.js.
- **Alerts**: Email alerts when resource thresholds are exceeded.
- **Logs**: Live-streaming logs via SSE.
- **System Check**: Built-in self-testing for Docker, Git, and SMTP.

## Installation (Debian 12)
1. Clone this repo to `/opt/deployer`.
2. Copy `.env.example` to `.env` and fill in your SMTP credentials.
3. Run `npm install`.
4. Copy `deployer.service` to `/etc/systemd/system/`.
5. Run `systemctl enable --now deployer`.
6. Set up Nginx using `nginx/nginx.conf`.

## Security
- SSH passphrases are stored only in memory and cleared after use.
- Secrets are managed via `.env` files within each project.
- HTTPS is recommended (Certbot scripts included).

## Memory Optimization
- Flask/Node limit: 300MB.
- Docker log rotation enabled.
- Task queue ensures only one heavy operation runs at a time.
