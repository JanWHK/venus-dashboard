---
name: deploying-to-production
description: Deploys the Helio dashboard to production at victron.afrinam.com (plain compose stack on labwhk behind Dokploy's Traefik), and diagnoses "merged to main but the live site did not change". Use when asked to deploy, ship, release, or push changes live; when production seems to be running old code; when production returns 502/404; or when checking whether production is behind origin/main.
allowed-tools: Bash, Read
---

# Deploying Helio to Production

## Quick Start

```bash
# Is production behind? Changes nothing.
.claude/skills/deploying-to-production/scripts/deploy-production.sh --check

# Deploy origin/main and verify end to end.
.claude/skills/deploying-to-production/scripts/deploy-production.sh

# Re-run verification against whatever is currently live.
.claude/skills/deploying-to-production/scripts/deploy-production.sh --verify
```

**Always run `--check` first and show the user the result before deploying.** Deploying is
outward-facing: confirm before you ship unless the user has already said go.

## The One Thing To Understand

**Merging to `main` does not ship it.** There is no webhook, no CI deploy, no polling.
Production is a **plain docker-compose stack** checked out on the `labwhk` host at
`/opt/labwhk/apps/venus`. Deploying means pulling into that checkout and rebuilding —
exactly like BarStockCounter's stack on the same host.

Dokploy runs on this host but is **only the traffic front-end**. Do not chase the Dokploy
UI or its tRPC API for deploys; the stack is ordinary compose and is not Dokploy-managed.

| | |
|---|---|
| Host | `labwhk`, LAN `192.168.100.104` (SSH user `janj`, key auth, in `docker` group) |
| App dir | `/opt/labwhk/apps/venus` (root-owned; git/compose run inside throwaway containers) |
| Compose project | `venus` — **load-bearing**, see below |
| Containers | `venus-venus-db-1`, `venus-venus-backend-1`, `venus-venus-frontend-1` |
| Public URL | `https://victron.afrinam.com/` (Cloudflare → dokploy-traefik → frontend nginx) |

## Load-Bearing Details

- **`-p venus`** — the project name ties the stack to volume `venus_venus-db-data` (the
  live database, whose Postgres password was fixed at first init) and to the container
  name `venus-venus-frontend-1` referenced by Traefik's file config. Any other name
  gives you a fresh empty DB (new volume) and a site that still 502s.
- **`-f docker-compose.prod.yml`** — be explicit; never let compose auto-load extras.
- **`--env-file .env`** — root-owned `.env` in the app dir holds the Postgres and MQTT
  credentials. The SSH user cannot write to it directly; read/edit it through an alpine
  container (`docker run --rm -i -v /opt/labwhk/apps/venus:/w -w /w alpine sh -c '...'`).
- **MQTT block required** — `VENUS_HOST=192.168.21.10`, `VENUS_PORT=8883`,
  `MQTT_TRANSPORT=tcp`, `MQTT_TLS=true`, `MQTT_TLS_INSECURE=true`, `MQTT_USERNAME`,
  `MQTT_PASSWORD` (same values as the local dev `.env`). Missing values mean the backend
  starts fine but sits "offline" with no GX data.
- **Git as root:** pull with
  `docker run --rm -v /opt/labwhk/apps/venus:/w -w /w alpine/git:latest -c safe.directory="*" pull origin main`.
  The checkout's origin URL has an embedded GitHub token; if it expires, set a fresh one
  before pulling.

## Deploy Steps

The script does all of this; run steps manually only if it fails.

1. `--check`: compare `origin/main` SHA vs the checkout's HEAD.
2. Pull main (alpine/git container, above).
3. Rebuild: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v /opt/labwhk/apps/venus:/w -w /w docker:cli compose -p venus -f docker-compose.prod.yml --env-file .env up -d --build`
4. Verify (below), every time.

## Verification — mandatory, never skip

| Check | Expectation |
|---|---|
| `docker ps` on labwhk | all three `venus-venus-*` containers Up, db healthy |
| `/api/health` via `127.0.0.1:8000` in backend | 200 |
| `http://venus-backend:8000/api/health` from frontend container | 200 — service DNS |
| `http://127.0.0.1/api/health` from frontend container | 200 — the `/api/` proxy |
| Origin: `curl -sk --resolve victron.afrinam.com:443:127.0.0.1 https://victron.afrinam.com/` | 200 |
| Backend `/proc/net/tcp` has an ESTABLISHED socket to GX port 8883 | MQTT is collecting |
| Backend log | no `Cannot connect`, no tracebacks; on a **fresh DB** a one-time setup key |
| Public URL through Cloudflare | 200 (see caveat) |
| Schema | `init_db()` runs additive DDL at startup — `CREATE TABLE IF NOT EXISTS` etc.; redeploy is safe, the log is the receipt |

Inside containers use `127.0.0.1`, never `localhost` (IPv6 ambiguity).

## Cloudflare Can Lie To You

Never confirm a deploy from the public URL alone — check the origin first (row above).
New builds produce new hashed asset names; `index.html` is served `cf-cache-status:
DYNAMIC` (uncached), but if the public URL ever returns a stale asset reference that
404s, purge the Cloudflare cache.

The app is code-split: `index.html` only references `index-*.js` / `vendor-*.js`. To
confirm a specific feature shipped, grep the lazy chunk (e.g. `Dashboard-*.js`) inside
`venus-venus-frontend-1:/usr/share/nginx/html/assets/`, not the public index.

## Fresh-Database Deploys

If the backend log prints `Helio first-use setup key: ...`, the DB volume was empty and
the site has **no accounts yet**. Use that key once at `/` to create the owner (admin).
Treat the key as a secret — it is in the container log only.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Merged to main, site unchanged | Nobody deployed — compare SHAs (`--check`) | Deploy |
| Site 502, Traefik answers 404/200 elsewhere | `venus-venus-frontend-1` not running | Deploy / inspect `docker ps -a \| grep venus` |
| Backend up, no GX data, `/api/live` says offline | MQTT env vars missing/wrong | Fix `.env`, re-run compose up |
| Postgres auth errors after password change | Named volume keeps first-init password | `ALTER ROLE venus ...` inside `venus-venus-db-1`, or keep the original `DATABASE_URL` |
| Frontend 404s for new assets at the edge | Cloudflare cached a stale index/404 | Purge CDN cache |
| Pull rejected, local changes in checkout | Old hand-edits on the server | `git checkout -- <file>` (they are superseded by main), then pull |

## Guidelines

- Run `--check` and report the result before deploying. Get the user's go-ahead.
- Never push to `main` directly as a deploy mechanism; deploy what is already merged.
- Never confirm success from the public URL alone; check the origin and MQTT socket.
- Never skip the verification block, even for a "tiny" change.
- Never print `.env` contents in full — mask secrets (`PASSWORD`, `DATABASE_URL`,
  `TOKEN`) before showing anything.
- Tell the user that open sessions need a refresh, since asset hashes change.
