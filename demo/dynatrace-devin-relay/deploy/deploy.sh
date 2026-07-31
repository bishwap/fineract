#!/usr/bin/env bash
#
# deploy.sh — stand up the full always-on demo on a fresh Ubuntu 22.04+ VM.
#
#   MySQL + Fineract (with the seeded FD defect) + relay + banking console + Caddy.
#
# Usage (run on the cloud VM, from the repo root):
#   cp demo/dynatrace-devin-relay/deploy/.env.deploy.example demo/dynatrace-devin-relay/deploy/.env.deploy
#   # edit .env.deploy (DOMAIN, DEVIN_API_TOKEN, DT_* ...)
#   sudo bash demo/dynatrace-devin-relay/deploy/deploy.sh
#
# Optional: install the Dynatrace OneAgent for authentic span/log capture by
# exporting DT_ENVIRONMENT + DT_PLATFORM_TOKEN before running (see DEPLOY.md).

set -euo pipefail
cd "$(dirname "$0")/../../.."          # repo root
DEPLOY_DIR="demo/dynatrace-devin-relay/deploy"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.demo.yml --env-file $DEPLOY_DIR/.env.deploy"

echo "==> [1/6] Installing Docker (if missing) + ensuring swap"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
# The Gradle build is memory-hungry; add swap on small VMs to avoid an OOM kill.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 6000 ]; then
  echo "   adding 4G swap"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile || true
fi

echo "==> [2/6] Optional: install Dynatrace OneAgent"
if [ -n "${DT_ENVIRONMENT:-}" ] && [ -n "${DT_PLATFORM_TOKEN:-}" ]; then
  source <(curl -sSL https://raw.githubusercontent.com/dynatrace-oss/dtwiz/main/scripts/install.sh) || true
  dtwiz setup || echo "   (OneAgent setup skipped/failed — the console still raises the Problem via API)"
else
  echo "   skipped (set DT_ENVIRONMENT + DT_PLATFORM_TOKEN to enable)"
fi

echo "==> [3/6] Building all images (Fineract build takes ~10-15 min) + starting MySQL and Fineract"
$COMPOSE build
$COMPOSE up -d fineractmysql fineract-server

echo "==> [4/6] Waiting for Fineract to be healthy (first boot runs DB migrations, be patient)"
for i in $(seq 1 60); do
  if $COMPOSE run --rm -T --no-deps console \
       curl -sk https://fineract-server:8443/fineract-provider/actuator/health 2>/dev/null | grep -q '"status":"UP"'; then
    echo "   Fineract is UP"; break
  fi
  sleep 15
  [ "$i" = "60" ] && echo "   WARNING: Fineract health not confirmed; continuing anyway"
done

echo "==> [5/6] Seeding a demo client + fixed-deposit product"
SEED=$($COMPOSE run --rm -e BASE_URL=https://fineract-server:8443 console bash scripts/seed-demo.sh || true)
echo "$SEED"
CID=$(echo "$SEED" | grep '^FD_CLIENT_ID=' | cut -d= -f2)
PID=$(echo "$SEED" | grep '^FD_PRODUCT_ID=' | cut -d= -f2)
if [ -n "$CID" ] && [ -n "$PID" ]; then
  sed -i "s/^FD_CLIENT_ID=.*/FD_CLIENT_ID=$CID/" "$DEPLOY_DIR/.env.deploy"
  sed -i "s/^FD_PRODUCT_ID=.*/FD_PRODUCT_ID=$PID/" "$DEPLOY_DIR/.env.deploy"
  echo "   pinned FD_CLIENT_ID=$CID FD_PRODUCT_ID=$PID"
fi

echo "==> [6/6] Starting relay, console and Caddy"
$COMPOSE up -d --build relay console caddy

echo
echo "==> Done."
DOMAIN=$(grep '^DOMAIN=' "$DEPLOY_DIR/.env.deploy" | cut -d= -f2)
if [ -n "$DOMAIN" ]; then
  echo "    Open:  https://$DOMAIN"
else
  echo "    Open:  http://<this-vm-public-ip>"
fi
