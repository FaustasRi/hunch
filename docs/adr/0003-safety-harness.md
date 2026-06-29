# ADR-0003 — Safety harness

**Status:** Accepted (2026-06-29)

## Context
An LLM that can place real-money orders is dangerous: hallucinated params, runaway loops, and the calibration trap (LLMs are systematically overconfident; a binary market converts that into negative expected value). The tool must be safe by default and structurally hard to misuse — this is also the project's design-integrity showcase.

## Decision
1. **Demo by default.** `KALSHI_ENV=demo`. Live requires **two conscious acts**: `KALSHI_ENV=live` + a live key. Fully uncapping requires a **third**: `DISABLE_LIMITS=true` (honored only with live).
2. **Preview → place, token-gated.** `preview_order` (read-only) prices the trade and issues an opaque token bound to the exact normalized order with a short TTL; `place_order` refuses without a valid, unexpired token. An un-previewed trade is structurally impossible — and this is the host-independent fallback when elicitation is unavailable.
3. **Hard caps in code:** `MAX_ORDER_USD=25`, `MAX_DAILY_USD=100` (rolling 24h), `MAX_OPEN_EXPOSURE_USD=250`. Measured as **cost basis = max loss** (YES @16¢ ⇒ $0.16/contract). **Reject, never clamp.** Apply in demo too (exercises the path; good for the demo GIF).
4. **Elicitation confirm** (MCP) on write tools when the host supports it, with the token gate as fallback — never silently execute, never hang.
5. **Append-only JSONL audit log** of every proposed/placed/cancelled order + fill.
6. **Kill switch:** `cancel_all_orders`.
7. **Honest framing:** server `instructions` state the miscalibration caveat — Hunch surfaces price/news/base-rate; the human decides size. No autopicking.
8. **Sports event contracts** gated behind `ALLOW_SPORTS` (US-state-dependent legality); live mode surfaces a one-time jurisdiction caveat.

## Consequences
- Live trading is deliberate; demo is frictionless and risk-free.
- Caps/token/audit are pure, unit-testable cores (see PLAN M4/M5).

## v1 implementation notes (M7)
- The two/three-act gate is enforced structurally in `config.ts`: env defaults to demo;
  a stray key alone cannot switch to live (it only changes the host when `KALSHI_ENV=live`);
  `DISABLE_LIMITS` is honored ONLY in live (`resolveDisableLimits`), so caps always exercise in demo.
- A stderr startup banner states the resolved env + caps and raises the live / uncapped / sports caveats.
- **Sports gating (point 8) in v1 = the `ALLOW_SPORTS` flag + a prominent live-mode jurisdiction/sports
  caveat that informs the user (legality is US-state-dependent and unknowable server-side).** Automatic
  per-market sports classification + hard rejection is deferred — it needs reliable category data and the
  informing caveat is the meaningful safeguard. Revisit if Kalshi market metadata makes classification cheap.
- **The daily cap is enforced per server PROCESS.** State is the audit log plus an in-memory ledger
  (`src/safety/ledger.ts`) so it survives an unwritable log; concurrency within the process is serialized by
  a mutex. Two separate server instances pointing at the **same** `AUDIT_LOG_PATH` (e.g. Claude Code *and*
  Codex launched from one cwd) each enforce the daily cap independently — there is no cross-process lock in
  v1 (the per-order and exposure caps still apply to both). Run one instance per `AUDIT_LOG_PATH`, or accept
  the daily cap is per-instance. A file-advisory-lock is the v2 fix.
