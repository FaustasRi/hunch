# fix_plan — Hunch v1

Autonomous build checklist. **Work the FIRST unchecked `[ ]` item only.** Full spec for each is the matching section in [`docs/PLAN.md`](docs/PLAN.md). Read [`CONTEXT.md`](CONTEXT.md) + [`AGENTS.md`](AGENTS.md) before starting.

For each item: implement → `npm run verify` green → commit (Conventional Commit, `Checkpoint: Mx`) → tick the box with a one-line note → continue.

**EXIT:** when every box below is `[x]`, print `EXIT_SIGNAL: hunch v1 complete` and stop. Do not invent new work.

- [x] **M0 — Skeleton boots & CI green.** No-op MCP server over stdio; `npm run verify` green; Inspector connects; registers in Claude Code.
- [x] **M1 — Kalshi client + RSA-PSS auth + `get_balance`.** Signed requests to demo; signer unit-tested; balance via mock (+ optional demo smoke).
- [x] **M2 — Market reads: `search_markets`, `get_market_brief` + market resource.** Fixed-point helpers tested; order-book bids-only handling correct; brief aggregates rules+prices+depth+trend.
- [x] **M3 — Portfolio reads: `get_positions`, `get_orders` + portfolio resource.** Exposure/status mapped; read uses legacy GET only.
- [x] **M4 — Order translation + `preview_order` (no money).** Exhaustive 8-combo translation truth table (incl. NO→YES-leg inversion); caps reject-not-clamp; confirmation token issues + expires.
- [ ] **M5 — `place_order` (token-gated) + `cancel_order` + `cancel_all_orders` + audit + confirm.** Mutation via V2 namespace only; refuses without valid token; audit log; demo smoke places+cancels.
- [ ] **M6 — Context polish: server `instructions` + 3 prompts.** Domain primer + miscalibration caveat; `/analyze-market`, `/scan-opportunities`, `/review-positions`.
- [ ] **M7 — Live-mode gate + safety review.** Demo default; live needs 2 acts, uncap needs 3rd; gating matrix tested; secret/cap/mutation audit passes.
- [ ] **M8 — Distribution & docs.** `npx -y hunch-mcp` boots from `npm pack`; README Claude Code + Codex snippets correct; CONTRIBUTING. → `EXIT_SIGNAL`.

## In progress
<!--
Empty = no checkpoint is mid-flight; the next iteration takes the first unchecked box.
If you must stop before finishing a checkpoint, REPLACE this comment with a precise note so a
memoryless next iteration resumes cleanly, e.g.:

  ### M2 (in progress)
  - done: fixedpoint.ts + tests; search_markets tool + fixtures
  - remaining: get_market_brief candlestick aggregation (series_ticker resolution) + market resource

Clear it back to empty when the checkpoint is finished.
-->

## Done log
<!-- Append one line per checkpoint as you complete it, newest last. e.g.:
- M0 ✅ <short note> (<commit sha>)
-->
- M0 ✅ Skeleton verified: scaffold (index.ts/server.ts/smoke.test.ts/ci.yml) boots over stdio, `initialize` handshake returns serverInfo+instructions, `npm run verify` green, CI runs `npm ci && npm run verify` (9045cd2).
- M1 ✅ Signed Kalshi client (injectable transport, mocked tests), RSA-PSS signer round-trip verified, config key-loading (inline/path/Keychain), `get_balance` tool live; server lists 1 tool (ecd97c9).
- M2 ✅ fixedpoint helpers (round-trip + edge tested), `search_markets` (filters/paging/text), `get_market_brief` (two-sided book from bids-only, series-via-event trend), `kalshi://market/{ticker}` resource; 3 tools + 1 resource (724bf74).
- M3 ✅ `get_positions` (signed→YES/NO, exposure/PnL, zero filtered), `get_orders` (legacy GET read, canonical outcome/book side + deprecated fallback, fill progress), `kalshi://portfolio` resource; 5 tools + 2 resources (4224ee2).
- M4 ✅ `translateOrder` (8-combo truth table, NO→YES-leg mirror), cost-basis caps (reject-not-clamp), audit read+rolling-24h, single-use TTL token store, `preview_order` (issues token only if caps pass); 6 tools (d33e16f).
