# HARDENING — post-v1 live-tested hardening pass

Checklist for hardening Hunch against the **real Kalshi demo API** + an all-fronts
quality pass. Each landed item: tests added, `npm run verify` green, committed.

> Safety: demo only, never live, every demo order cancelled. The gated live test runs
> only with `KALSHI_DEMO_KEY=1`.

## Phase 1 — live demo end-to-end ✅

- [x] Drove the real demo API through the full path: balance ($100), search, brief,
      preview→token→place (real order placed + seen resting), cancel, cancel_all,
      cap-reject ($50>$25), no-token reject, buy-NO→sell-YES@99¢ mirror — all correct.
- [x] Baked the validated lifecycle into the gated `test/integration.demo.test.ts`
      (place 1¢×1 → get_orders → cancel → finally cancel_all). Verified live: passes,
      account left clean (0 resting, $100). (e4e9661)

## Phase 2 — write-path safety ✅ (05c115f)

- [x] Daily-cap TOCTOU closed with an in-process Mutex (also makes same-token concurrency safe).
- [x] Real idempotency: stable client_order_id per preview; peek→POST→remove-on-resolved;
      ambiguous failure keeps the token (retry dedupes), definite 4xx burns it.
- [x] Audit symmetry: cancel_order / cancel_all log declines + list-failures; place audits
      invalid/expired tokens. Daily sum env-scoped. Audit write never throws (best-effort).
- [x] Tests: TOCTOU concurrency, idempotent retry, audit write-side + cancel-side, peek/remove/sweep.

## Phase 3 — search overhaul ✅ (a391d78)

- [x] Event-based discovery (`src/kalshi/discovery.ts`): markets have no title, events do.
- [x] search_markets modes: text (rank events → expand to markets), category, exact,
      landing, helpful empty state. Relevance scoring + bounded scan + partial-scan flag.
- [x] The live "bitcoin" false-negative now passes; CONTEXT.md updated.

## Phase 4 — reads + UX polish ✅ (8e8f35c, 37e6a28)

- [x] Brief: suppress "last 0¢"; defensive book (bad level can't sink it); best-effort
      orderbook; cap long rules + render secondary; crossed-book label; untrusted-data note.
- [x] get_balance rejects non-numeric ($NaN); exposure summed across ALL pages; get_orders
      never fabricates a direction + shows type; negative P&L "-$3.25".
- [x] Client errors capped + non-JSON summarized (no context bomb); 401/429 hints.
- [x] Tool descriptions / instructions (prompt-injection caveat, fee P) / banner (sports
      honesty) / README (max loss) tightened.

## Verification ✅

- [x] Final clean live demo end-to-end run passes; demo account left clean (0 resting, $100).
- [x] Two adversarial verifier sub-agents confirmed the core properties hold and the tests
      are non-vacuous (proven by probe). Each found a residual hole in the "defensive" code —
      audit-durability daily-cap bypass, and a structural-junk orderbook still sinking the
      brief — both fixed in the verification round (fe855d7) with new tests.
- [x] Final safety-audit sub-agent verdict: **CLEAN** — token gate (one createOrderV2 caller),
      V2-only mutation, reject-not-clamp caps (durable across audit-write failure + concurrency),
      full audit coverage, no secret in logs, demo-default live gate, prompt-injection caveat.
      `npm run verify` green (135 pass, 2 gated-skip). Pushed. → **HARDENING COMPLETE**

## Known v2 follow-ups (documented, out of scope)

- Cross-process daily cap: two server instances sharing one `AUDIT_LOG_PATH` each enforce
  independently (no cross-process lock). Per-order + exposure caps still apply. (ADR-0003.)
- An ambiguous-failure order that landed but is never retried isn't counted toward the daily
  cap (logged as `error`; user directed to get_orders + idempotent retry). Inherent to network ambiguity.
- Automatic per-market sports classification (v1 = ALLOW_SPORTS flag + informing caveat).
