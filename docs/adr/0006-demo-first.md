# ADR-0006 — Demo-first distribution

**Status:** Accepted (2026-06-29)

## Context
Hunch is a free, open-source, portfolio project meant to be usable by anyone the moment they clone it — without funding an account, KYC, geo-restrictions, or risking money. Kalshi ships a full **demo** environment (real market mechanics, fake money, separate keys/host).

## Decision
- Default `KALSHI_ENV=demo`; the published `npx -y hunch-mcp` and all README/Codex snippets default to demo.
- Tests run against **mocked** Kalshi responses; the only human step is a one-time ~2-minute demo-account + key setup to run the live demo smoke test. The build loop never blocks on a key.
- Live is the deliberate opt-in (ADR-0003).

## Consequences
- The default experience is risk-free and legally clean, sidestepping geoblock/KYC/loss concerns entirely.
- The demo path is the primary thing the demo GIF and CI exercise; live is a thin, gated delta on top.
