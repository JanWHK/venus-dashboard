# Deploying Helio

Production: **https://victron.afrinam.com**. The live application is a plain Compose
stack on `labwhk` (`janj@192.168.100.104`), under `/opt/labwhk/apps/venus`.
Dokploy supplies Traefik routing only. Merging a PR does not deploy automatically.

The existing project deployment guide and script are read-only references for Codex:
`.claude/skills/deploying-to-production/SKILL.md` and its `scripts/deploy-production.sh`.
Do not use the separate BarStockCount deployment skill for this repository.

## Required identity and safety checks

- Compose project: **venus**. Preserve volume `venus_venus-db-data`.
- Compose file: **docker-compose.prod.yml**. Environment file: server **.env**.
- Containers: `venus-venus-db-1`, `venus-venus-backend-1`, `venus-venus-frontend-1`.
- Keep one backend process. Keep the existing DB/MQTT credentials and GX route.
- Never print `.env` or the production Git remote: its URL contains credentials.
- Never reset a dirty production checkout, remove volumes, or change DB passwords
  as a routine deployment step. Investigate unexpected differences first.
- Review schema changes and take a database backup before deployment.

## Release workflow

1. Read `AGENTS.md`, `HANDOFF.md`, this document, and the project deployment guide.
2. Run the read-only deployment check and inspect remote `git status --short`.
3. Test locally. The alert release has 46 passing backend tests, a passing production
   frontend build, validated Compose files, and desktop/mobile browser checks.
   See `ALERTS.md` for the disposable PostgreSQL test command.
4. Commit only the intended files to a feature branch; push and open a PR to `main`.
   Respect required reviews/checks. Merge only with release authorization.
5. Back up the live database, record the previous SHA and image IDs, then deploy
   merged `origin/main` using the project script.
6. Verify the origin, public edge, current asset files, authentication, database
   schema, and live GX connection. Record the result on the PR.

```sh
rtk bash .claude/skills/deploying-to-production/scripts/deploy-production.sh --check
rtk bash .claude/skills/deploying-to-production/scripts/deploy-production.sh
rtk bash .claude/skills/deploying-to-production/scripts/deploy-production.sh --verify
```

The check exits nonzero when production is behind; read its output to distinguish
expected drift from a connection failure. The script compares checkout SHAs, so a
failed build after a successful pull can leave HEAD ahead of the running images.
In that case, do not trust a subsequent "already up to date" alone. Rebuild the
same validated checkout explicitly and verify the running assets and containers.

The manual rebuild, if the script fails, is:

```sh
rtk ssh janj@192.168.100.104 'docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/labwhk/apps/venus:/w -w /w docker:cli \
  compose -p venus -f docker-compose.prod.yml --env-file .env up -d --build'
```

If only the backend is recreated and the frontend proxy returns 502, check direct
service DNS versus nginx's `/api/` proxy. Restart only `venus-venus-frontend-1` if
nginx retained the old upstream IP. Do not restart unrelated stacks.

## Alert release (2026-09-21)

Pre-release production baseline: `686ed3c`. Only two new tables are introduced:
`battery_alert_rules` and `battery_alerts`. Existing readings, summary history,
accounts, and generator runs are preserved. Startup creates the tables additively.
Environment additions are optional Telegram/SMTP values; absent credentials leave
the app alarm functional and display external channels as not configured.

Pre-release backup validated with `pg_restore --list`:
`/home/janj/venus-backups/pre-battery-alerts-20260921.dump` on `labwhk`
(210,694 bytes, mode 600). Prior images, retained for recovery:

- Backend: `sha256:21bd3696e99030a257918221fbcf2fa2a0d471d1c263dc5dc9339cf28f058bc8`.
- Frontend: `sha256:8eb084a759ece5d45970d537fa5c3f3fe787e6da672043fd8b67d1023087a183`.

Required production acceptance checks:

- Three expected containers running; Postgres healthy.
- Backend `/api/health`, frontend service-DNS check, and nginx proxy all return 200.
- Origin and public homepage/client routes/assets return 200.
- Anonymous `/api/alerts`, `/api/live`, `/api/settings`, and `/api/readings` return 401.
- Both alert tables exist; the three threshold rules initialize after fresh SOC.
- Established connection to GX port 8883 and no startup tracebacks.
- Built frontend contains the battery watch/alarm controls.
- External messages remain unverified until the operator provides private
  Telegram/SMTP credentials and confirms receipt. Never fabricate a successful send.

Refresh open browser sessions after deployment to load the new asset hashes.

## Rollback

Retain the pre-release backend/frontend image IDs and database backup. If verification
fails, inspect the failure before making additional changes. Use a reviewed Git revert
PR followed by the normal deployment workflow for a code rollback, or explicitly
approved previous-image recovery for an urgent outage. Alert tables are additive
and can remain when rolling back code; do not drop them or restore the entire DB
unless data corruption requires it and the operator authorizes the loss of later data.
