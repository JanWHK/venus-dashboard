#!/usr/bin/env bash
# Deploy the Helio dashboard to production (victron.afrinam.com).
#
# Production is a plain docker-compose stack ("venus") on the host `labwhk`,
# served by Dokploy's Traefik via file provider. Nothing auto-deploys: merging
# to main does not ship. See ../SKILL.md for the full picture.
#
#   ./deploy-production.sh --check    # report drift only, change nothing
#   ./deploy-production.sh            # pull + rebuild + verify
#   ./deploy-production.sh --verify   # re-run verification against what is live
set -euo pipefail

SSH_TARGET="${VENUS_PROD_SSH:-janj@192.168.100.104}"
APP_DIR="${VENUS_APP_DIR:-/opt/labwhk/apps/venus}"
PROJECT="venus"                      # load-bearing: volume + Traefik container name
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
DOMAIN="victron.afrinam.com"
BRANCH="${VENUS_DEPLOY_BRANCH:-main}"
GX_MQTT_PORT_DEC=8883
GX_MQTT_PORT_HEX=22B3

c_red=$'\e[31m'; c_grn=$'\e[32m'; c_yel=$'\e[33m'; c_bld=$'\e[1m'; c_off=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$c_bld" "$1" "$c_off"; }
ok()   { printf '%s  ok%s   %s\n' "$c_grn" "$c_off" "$1"; }
warn() { printf '%s  warn%s %s\n' "$c_yel" "$c_off" "$1"; }
die()  { printf '%s  FAIL%s %s\n' "$c_red" "$c_off" "$1" >&2; exit 1; }

# git in a throwaway container: the app dir is root-owned, and this avoids
# needing git on the host or fighting `safe.directory`.
remote_git() {
  ssh "$SSH_TARGET" "docker run --rm -v $APP_DIR:/w -w /w alpine/git:latest \
    -c safe.directory='*' $*"
}

remote_compose() {
  ssh "$SSH_TARGET" "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    -v $APP_DIR:/w -w /w docker:cli compose -p $PROJECT \
    -f $COMPOSE_FILE --env-file $ENV_FILE $*"
}

origin_code() {
  ssh "$SSH_TARGET" "curl -sk --resolve $DOMAIN:443:127.0.0.1 -o /dev/null \
    -w '%{http_code}' https://$DOMAIN$1"
}

check_drift() {
  step "Comparing origin/$BRANCH with what is deployed"
  git fetch origin --quiet
  LOCAL_SHA=$(git rev-parse --short "origin/$BRANCH")
  LOCAL_MSG=$(git log --format=%s -1 "origin/$BRANCH")
  DEPLOYED=$(remote_git log --oneline -1)
  DEPLOYED_SHA=$(awk '{print $1}' <<<"$DEPLOYED")
  printf '  origin/%-8s %s  %s\n' "$BRANCH" "$LOCAL_SHA" "$LOCAL_MSG"
  printf '  deployed      %s\n' "$DEPLOYED"
  [ "$LOCAL_SHA" = "$DEPLOYED_SHA" ]
}

verify() {
  step "A) all three containers up, database healthy"
  ssh "$SSH_TARGET" "docker ps --format '{{.Names}} {{.Status}}' | grep venus-venus-" \
    || die "venus-venus-* containers are not all running"
  ssh "$SSH_TARGET" "docker ps --format '{{.Names}} {{.Status}}' | grep 'venus-venus-db-1.*(healthy)'" \
    || die "database container is not healthy"
  ok "db healthy, backend and frontend up"

  step "B) backend answers /api/health on 127.0.0.1:8000"
  ssh "$SSH_TARGET" "docker exec $PROJECT-venus-backend-1 python -c \
    'import urllib.request;print(urllib.request.urlopen(\"http://127.0.0.1:8000/api/health\").status)'" \
    | grep -q 200 || die "backend /api/health is not 200"
  ok "backend healthy"

  step "C) nginx reaches the backend by service DNS, and proxies /api/"
  ssh "$SSH_TARGET" "docker exec $PROJECT-venus-frontend-1 sh -c \
    'wget -qO- -T 3 http://venus-backend:8000/api/health >/dev/null'" \
    || die "nginx cannot reach venus-backend:8000 — check the compose network"
  ok "venus-backend:8000 reachable from nginx"
  ssh "$SSH_TARGET" "docker exec $PROJECT-venus-frontend-1 sh -c \
    'wget -qO- -T 3 http://127.0.0.1/api/health >/dev/null'" \
    || die "/api/ proxy is broken inside nginx"
  ok "/api/ proxy intact"

  step "D) site answers 200 at the origin (bypassing Cloudflare)"
  [ "$(origin_code /)" = "200" ] || die "origin / is not 200"
  ok "origin / is 200"

  step "E) MQTT collector has an ESTABLISHED socket to the GX on :$GX_MQTT_PORT_DEC"
  ssh "$SSH_TARGET" "docker exec $PROJECT-venus-backend-1 python -c \"
import sys
state = None
for line in open('/proc/net/tcp'):
    f = line.split()
    if len(f) > 3 and f[2].endswith(':$GX_MQTT_PORT_HEX'):
        state = f[3]
sys.exit(0 if state == '01' else 1)\"" \
    || die "no ESTABLISHED MQTT socket to the GX — check the MQTT block in $ENV_FILE"
  ok "MQTT to the GX is connected"

  step "F) backend log for errors and first-use setup key"
  LOG=$(ssh "$SSH_TARGET" "docker logs $PROJECT-venus-backend-1 2>&1 | tail -30")
  grep -qi "traceback" <<<"$LOG" && { echo "$LOG" | tail -20; die "traceback in backend log"; }
  if grep -q "Helio first-use setup key" <<<"$LOG"; then
    warn "fresh database: complete first-use setup at https://$DOMAIN (key is in the log)"
  else
    ok "no setup key (accounts exist), no tracebacks"
  fi

  step "G) public URL through Cloudflare"
  PUBLIC=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
  [ "$PUBLIC" = "200" ] \
    && ok "https://$DOMAIN/ is 200 at the edge" \
    || warn "public URL returned $PUBLIC — origin is fine, check Cloudflare cache"
}

case "${1:-deploy}" in
  --check)
    check_drift && ok "production is up to date" || die "production is behind origin/$BRANCH"
    ;;
  --verify)
    verify
    ;;
  deploy)
    step "Deploying origin/$BRANCH to $DOMAIN"
    check_drift && { ok "already up to date"; verify; exit 0; }
    step "Pulling latest main into the production checkout"
    remote_git pull origin main || die "git pull failed (expired checkout token? set a fresh remote URL)"
    DEPLOYED=$(remote_git log --oneline -1); ok "deployed checkout: $DEPLOYED"
    step "Rebuilding and recreating the stack"
    remote_compose up -d --build | tail -4
    verify
    ;;
  *)
    die "usage: $0 [--check | --verify | deploy]"
    ;;
esac
