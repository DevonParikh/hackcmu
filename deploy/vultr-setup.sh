#!/usr/bin/env bash
# deploy/vultr-setup.sh — put the agent service on a fresh Vultr Ubuntu 24.04 box, as a systemd service.
#
#   On the box, as root:
#     git clone https://github.com/DevonParikh/hackcmu.git /opt/hackcmu && cd /opt/hackcmu
#     bash deploy/vultr-setup.sh
#   Then copy keys/ and .env from the laptop that ran `npm run floor` (scp -r keys .env root@<ip>:/opt/hackcmu/),
#   set MONGODB_URI (Atlas), GEMINI_API_KEY, ELEVENLABS_API_KEY and, for login, the AUTH0_* variables in /opt/hackcmu/.env,
#   and start it:   systemctl restart allowance && journalctl -u allowance -f
#
# The service listens on :3000. Put Caddy or nginx in front for HTTPS (the browser microphone needs https or localhost):
#     apt-get install -y caddy && printf 'agent.example.com {\n  reverse_proxy 127.0.0.1:3000\n}\n' > /etc/caddy/Caddyfile && systemctl restart caddy
#
# DEVNET ONLY. The keys you copy are throwaway devnet keys. Never put a funded mainnet key on this box.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm ci --omit=dev --no-audit --no-fund

install -m 0644 deploy/allowance.service /etc/systemd/system/allowance.service
sed -i "s|/opt/hackcmu|$ROOT|g" /etc/systemd/system/allowance.service
systemctl daemon-reload
systemctl enable allowance
echo
echo "Installed. Copy keys/ and .env here, fill in the API keys, then: systemctl restart allowance"
echo "Health check from outside:  curl http://<this box>:3000/api/state"
