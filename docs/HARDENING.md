# HARDENING — post-v1 live-tested hardening pass

Checklist for hardening Hunch against the **real Kalshi demo API** + an all-fronts
quality pass. Tick items as they land (each: tests added, `npm run verify` green,
committed). A memoryless next iteration can resume from the unticked boxes.

> Safety: demo only, never live, every demo order cancelled. Creds via env
> (`KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH`); the gated live test runs only with
> `KALSHI_DEMO_KEY=1`.

## Phase 1 — live demo end-to-end (DONE — exploratory)

- [x] Drove the real demo API through the full code path: balance ($100), search,
      brief, preview→token→place (real order placed + seen resting), cancel,
      cancel_all (cleanup), cap-reject ($50>$25), no-token reject, buy-NO→sell-YES@99¢
      mirror. All correct. Auth/signing/fixed-point all work against the real API.
- [ ] Bake the validated lifecycle into the gated `test/integration.demo.test.ts`
      (place 1¢×1 → get_orders → cancel → cancel_all in `finally`), demo-guarded.

### Live findings (real-world)
1. **Search is broken for real use** — `query:"bitcoin"` → 0 hits, yet 58 bitcoin
   events exist. Markets have NO title; only events carry title/category/series. There
   are 10,000+ open markets (single-page substring search is hopeless). → Phase 3.
2. **Brief shows `last 0¢`** for markets with no last trade (illiquid). Misleading. → Phase 4.
3. Market object `status` is `"active"` (not `"open"` — that's the query vocabulary).
   Confirm nothing compares against `market.status === 'open'`. → Phase 4.

## Phase 2 — audit findings (safety/quality from the review)

- [ ] Consistent audit logging across ALL write tools (declined-confirm + every
      outcome logged in cancel_order / cancel_all_orders, like place_order). + tests.
- [ ] Daily-cap TOCTOU in place_order: read-before-POST / append-after — mitigate or
      document explicitly; test the chosen behavior.
- [ ] audit.test.ts: test the append/WRITE side + cancel-side audit (currently untested).
- [ ] (fold in the 3 background auditor reports — order/safety, reads/fixed-point, UX/docs)

## Phase 3 — search overhaul (biggest UX win) — VALIDATED design

Markets lack titles; **events carry title + category + series_ticker** and
`/events?with_nested_markets=true` returns markets inline. 12 categories exist.

- [ ] `src/kalshi/discovery.ts`: typed `/events` + `/series` fetchers + KALSHI_CATEGORIES.
- [ ] `search_markets` v2 modes: precise (tickers/series/event → /markets), text
      (event-based: scan/rank events by tokenized title+series+category match → return
      top events' markets + the rest as drill-in events), category browse, landing
      (lists categories), and a helpful empty state instead of a dead end.
- [ ] Relevance scoring (title > meta), early-stop scan with a page cap (surface if capped).
- [ ] Mocked tests with /events fixtures (incl. the "bitcoin" false-negative now passing).
- [ ] Update CONTEXT.md + the tool description.

## Phase 4 — discover more / polish

- [ ] Brief: suppress misleading `last 0¢`; handle closed/settled + illiquid gracefully.
- [ ] Tool descriptions / error messages / edge cases per the auditor reports.
- [ ] Prompt-injection note (market text is untrusted data, not instructions) if warranted.

## Verification

- [ ] Adversarial verifier sub-agent(s) confirm each fix holds + tests assert the property.
- [ ] Final clean live demo end-to-end run passes.
- [ ] Final safety-audit sub-agent confirms harness still clean (token gate, V2-only
      mutation, caps, audit coverage).
- [ ] `npm run verify` green; pushed to main; → `HARDENING COMPLETE`.
