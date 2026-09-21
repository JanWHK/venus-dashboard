# Battery alerts

Helio monitors fresh GX battery state of charge, independently of the optional
summary recording interval. MQTT remains read-only. Nothing starts, stops, or
controls the inverter, battery, charger, or generator.

## Alert policy

- **50% advisory:** reduce nonessential loads and watch charging availability.
- **25% warning:** reduce loads now and arrange charging.
- **15% critical:** act now to avoid loss of power.

The backend checks every 10 seconds. A threshold must remain at or below its value
for 30 seconds before firing. Missing, invalid, disconnected, or stale SOC resets
that confirmation timer. A sampling gap over 20 seconds also resets it. GX readings
use the collector's existing 90-second freshness limit.

Each threshold fires once per discharge cycle. It rearms only above 55%, 30%, or
20%, respectively. A sudden drop through several thresholds produces the strongest
alert only. Alert state survives restarts; the short confirmation timer restarts.
Critical alerts repeat every 10 minutes until acknowledged or recovered above 20%.
Stale readings pause messages and reminders; they do not imply recovery. The app
shows missing telemetry separately. There is no remote offline-telemetry alert yet.

All authenticated users see the app banner and recent alert history on every page.
Only an administrator can acknowledge an alert for everyone. Acknowledgement stops
reminders and cancels queued delivery; it does not disable later threshold alerts.
An already in-flight message may still arrive.

Click **Enable alarm sound** after opening the app. Advisory, warning, and critical
use one, two, and three progressively higher tones. Critical sound repeats every
minute until acknowledged, muted, recovered, or telemetry becomes unavailable.
Audio is opt-in per page session; browser suspension, muted devices, or a closed
page can prevent sound. This is not a native background phone alarm.

Telegram is primary. Email is attempted when Telegram is unavailable, not configured,
or rejects/fails a request. Successful Telegram delivery leaves email on standby.
If both fail, delivery retries up to three times, respecting Telegram's retry delay.
Pending notifications expire after one hour instead of sending old warnings.
Critical reminders start a new delivery cycle. Provider acceptance is shown as
"sent"; it does not prove the recipient read the message. A timeout or process
crash after provider acceptance can produce a duplicate on retry.

Only alert transitions, acknowledgements, and delivery status are persisted in
`battery_alert_rules` and `battery_alerts`. Detailed telemetry is not recorded by
this feature. The API returns the latest 20 events plus active alerts. Run exactly
one backend process/replica, as required by the existing collector architecture.

## Configure private delivery

Put these values in the ignored `.env` file or deployment secret store, never in
source code, screenshots, commits, or chat. Both Compose files forward them.

1. Create a Telegram bot using Telegram's official **@BotFather**. Save the token as
   `TELEGRAM_BOT_TOKEN`. Start a private conversation with the bot (or add it to your
   intended private group). Set that destination's numeric ID as `TELEGRAM_CHAT_ID`.
   Verify the destination before sending any test message. Telegram's official
   [Bot API documentation](https://core.telegram.org/bots/api) describes `getUpdates`
   for discovering the chat ID and `sendMessage` for delivery. Never paste the
   token-bearing request URL into logs or shared browser history.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, and
   `SMTP_PASSWORD`. Use your mail provider's dedicated SMTP/app password.
   `SMTP_SECURITY=starttls` normally uses port 587; `ssl` normally uses 465.
   TLS certificate validation is always enabled; plaintext SMTP is rejected.
3. Set `ALERT_EMAIL_FROM` to an approved sender and `ALERT_EMAIL_TO` to your own
   recipient address. Do not configure another person's destination without approval.
4. Recreate the local backend after changing environment values:
   `rtk docker compose up -d --build venus-backend venus-frontend`.
   Production deployment requires its separate approval and secrets configuration.
5. Sign in. Expand **Delivery status & recent alerts**. Both channels should show
   "configured". This means credentials are present, not that they have been verified.

The backend needs continuous GX connectivity, power, and internet access. Telegram
and SMTP can fail together during an internet outage. Browser sound is the local
fallback only while the page is open. Do not use this as the sole battery protection
mechanism; retain device-level protections.

## Verification and handoff checklist

Verified locally on 2026-09-21: **46 backend tests passed**, frontend production
build passed, and both Compose files validated. Browser checks covered the actual
alert component with simulated data on desktop/light and mobile/dark layouts,
opt-in audio controls, acknowledgement, and missing telemetry. The local stack
was rebuilt. Production release checks and procedure are in `DEPLOYMENT.md`;
the release PR records the deployment outcome. Telegram and email were **not
configured** during testing, so actual external delivery has not been verified.

- [x] Implement threshold evaluation, persistence, app banner, opt-in audio,
  acknowledgement, Telegram delivery, email fallback, and bounded retries.
- [ ] Operator supplies Telegram bot/chat and SMTP credentials privately.
- [ ] Operator verifies actual Telegram and email receipt on intended devices.
- [x] Production release authorized on 2026-09-21; track execution and verification on the release PR.

Automated backend tests use a disposable PostgreSQL database whose name ends in
`_test`. Never point tests at the live database. Run from the repository root:

```sh
rtk docker compose build venus-backend
rtk docker run --rm --network victron-helio_venus-net \
  -v /home/janj/victron/backend/tests:/app/tests:ro \
  -e TEST_DATABASE_URL=postgresql+asyncpg://venus:venus@venus-db:5432/venus_test \
  -e DATABASE_URL=postgresql+asyncpg://venus:venus@venus-db:5432/venus_test \
  victron-helio-venus-backend sh -c \
  'pip install -q -r requirements-dev.txt && python -m pytest tests -q -p no:cacheprovider'
rtk npm run build --prefix frontend
```

Tests simulate 50/25/15% crossings, equality, debounce, jumps, stale/invalid values,
recovery hysteresis, restart deduplication, administrator-only acknowledgement,
delivery retries, Telegram rate limits, and SMTP fallback. Network providers are
mocked; no real alert messages are sent by automated tests.

Manual checks:

1. Open desktop and 390px mobile layouts, in light and dark themes. Check wrapping,
   expand delivery details, and use **Enable alarm sound** to hear the test tone.
2. Verify viewers cannot acknowledge alerts; anonymous requests return 401.
3. Simulate low SOC only in the isolated test database/browser mocks. Never publish
   fake or control MQTT messages to the real GX. Verify increasing severity and
   acknowledgement; no real discharge is required.
4. Once recipients are configured and confirmed, explicitly send a test Telegram
   message from the backend: `rtk docker compose exec venus-backend python -c
   'from alerts import send_telegram; print(send_telegram("Helio TEST: notification check, no battery alarm"))'`.
   Confirm receipt. The result prints only success and retry delay, not credentials.
5. Test email independently: `rtk docker compose exec venus-backend python -c
   'from alerts import send_email; print(send_email("Helio TEST: email backup check\\nNo battery alarm."))'`.
   Confirm receipt and spam-folder behavior. These two commands send real messages;
   run them only after confirming the configured destinations.
6. Close the browser and repeat the explicit delivery tests. Backend notifications
   must still arrive. Reopen the app to confirm monitoring remains available.
