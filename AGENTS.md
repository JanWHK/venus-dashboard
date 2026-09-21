# Project workflow

- Start from [HANDOFF.md](HANDOFF.md) — current state, run/test commands and known gotchas.
- Prefix shell commands with `rtk`. Use `rtk proxy` only when a filtered result is unusable.
- Use the `caveman` skill for concise communication. Keep source, documentation and UI copy in normal English.
- Prefer codebase-memory-mcp for code discovery. Re-index after significant changes.
- Fetch relevant external library documentation with Context7 before implementing third-party APIs.
- Preserve existing recordings, user edits and `NETWORK_HANDOFF.md`.
- Telemetry is read-only: subscribe to GX notifications and request keepalive. Never publish device control commands.
- Keep live readings in bounded memory; persist only optional summary readings.
- Require authentication for live, device, settings and history APIs. Demo data must remain explicitly labeled and separate.
- Verify backend authentication and stale-data behavior, frontend production build, and desktop/mobile screens.
- Do not commit credentials or modify Claude-owned configuration.
