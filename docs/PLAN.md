# PLAN — Hunch v1 build, checkpoint by checkpoint

Tracer-bullet vertical slices. Each checkpoint is independently shippable, ends `npm run verify`-green, and has a concrete Definition of Done (DoD). The loop works the **first unchecked** item in [`../fix_plan.md`](../fix_plan.md); this file is the detail.

**Global rules** (from [`../AGENTS.md`](../AGENTS.md)): mocked tests, never block on a key, never trade live in CI, secrets out of logs/git, caps reject-not-clamp, demo default, build before commit.

**Testing model.** Unit/contract tests use **fixtures** (`test/fixtures/*.json`) shaped like real Kalshi responses + a `MockKalshiTransport`. Live calls are exercised only by `it.skipIf(!process.env.KALSHI_DEMO_KEY)` integration tests and by the human's one-time demo smoke test. Aim for the risky cores (signing, fixed-point, order translation, caps, preview token) to be fully unit-covered.

---

## M0 — Skeleton boots & CI is green

**Goal.** A no-op MCP server that starts over stdio, registers zero tools, and a green pipeline.

**Touch.** `src/index.ts` (entry: build server, connect `StdioServerTransport`), `src/server.ts` (`createServer()` returns a configured `McpServer` with name/version/instructions placeholder), `test/smoke.test.ts` (server constructs without throwing), `.github/workflows/ci.yml` (already scaffolded — confirm it runs `npm ci && npm run verify`).

**Look.** REFERENCES → MCP TypeScript SDK `docs/server.md` (McpServer + StdioServerTransport).

**Watch.** NodeNext ESM — `.js` import extensions; `verbatimModuleSyntax` (use `import type` for types). Don't print to stdout (it's the JSON-RPC channel) — logs go to **stderr**.

**Done.** `npm install` then `npm run verify` is green. `node dist/index.js` starts and stays up on stdio. `npx @modelcontextprotocol/inspector node dist/index.js` connects. A `.mcp.json` pointing at `node /abs/path/dist/index.js` registers in Claude Code and lists the server (no tools yet).

---

## M1 — Kalshi client + RSA-PSS auth (read-only spine: `get_balance`)

**Goal.** A thin typed Kalshi client that signs requests and reads balance from **demo**. First real tool.

**Touch.** `src/config.ts` (load env: `KALSHI_ENV`, key id, private key path/inline, caps; macOS Keychain helper with env fallback), `src/kalshi/signing.ts` (the Node signer — code in REFERENCES), `src/kalshi/client.ts` (base URL by env, signed GET/POST/DELETE, header assembly, error mapping), `src/kalshi/types.ts` (Balance + shared types), `src/tools/get_balance.ts`, wire into `src/server.ts`. Tests: `test/signing.test.ts`, `test/get_balance.test.ts`.

**Look.** REFERENCES → Auth, Balance, hosts. Study the Python starter signer for the algorithm.

**Watch.** Signed string = `timestampMs + METHOD + path`, path includes `/trade-api/v2`, **excludes** query. Timestamp is **ms**. Demo/prod different hosts + keys. Never log the key or signature. `get_balance` is `readOnlyHint: true`.

**Done.** `test/signing.test.ts` verifies the signer with a fixed key + known message (a deterministic verify against a public key, or a round-trip verify). `get_balance` returns a typed balance against a mocked transport. **Human demo smoke (one-time, optional now):** with a real demo key in `.env`, `get_balance` returns the demo account's balance. Server now lists 1 tool.

---

## M2 — Market data reads (`search_markets`, `get_market_brief`) + market resource

**Goal.** Discover markets and produce the rich one-shot brief that powers conversation.

**Touch.** `src/kalshi/fixedpoint.ts` (dollar-string ↔ number, cents ↔ dollars, `_fp` parsing) + `test/fixedpoint.test.ts`, `src/tools/search_markets.ts`, `src/tools/get_market_brief.ts` (aggregates `GET /markets/{ticker}` + orderbook + a compact recent trend; resolves `series_ticker` for candlesticks), `src/resources/market.ts` (`kalshi://market/{ticker}`), types in `src/kalshi/types.ts`. Tests + fixtures for markets/orderbook/candlesticks.

**Look.** REFERENCES → Get markets, Get market, Order book, Candlesticks.

**Watch.** Fixed-point strings (use the helpers, never `parseFloat` ad hoc). Order book is **bids-only on both legs** — derive ask depth from the opposite leg (YES bid @p = NO ask @1−p); don't double-count. Candlesticks need `series_ticker` in the path. Keep the brief **bounded** (don't dump 1000 candles — a compact trend summary).

**Done.** `test/fixedpoint.test.ts` covers cents↔dollars↔fp round-trips and edge prices (1¢, 99¢). `search_markets` filters and paginates against fixtures. `get_market_brief` returns rules + YES/NO prices + a correctly-derived two-sided depth view + trend, from fixtures. Resource resolves. Server lists 3 tools + 1 resource.

---

## M3 — Portfolio reads (`get_positions`, `get_orders`) + portfolio resource

**Goal.** See positions and resting/recent orders.

**Touch.** `src/tools/get_positions.ts`, `src/tools/get_orders.ts` (status filter; fold "did it fill" via `fill_count_fp` — no separate fills tool), `src/resources/portfolio.ts` (`kalshi://portfolio`), types. Tests + fixtures.

**Look.** REFERENCES → Balance/positions/fills, Get orders (read stays on legacy GET path).

**Watch.** `get_orders` READ uses `GET /portfolio/orders` (legacy read is fine); do **not** use legacy for mutation. Map `outcome_side`/`book_side`/`status` clearly. `exposure`/`realized_pnl` come off positions — `get_pnl` is derivable, don't add a tool.

**Done.** Positions + orders render from fixtures with exposure/status. Portfolio resource composes balance+positions. Server lists 5 tools + 2 resources.

---

## M4 — Order translation + `preview_order` (the riskiest core, no money)

**Goal.** Translate conversational orders to the V2 wire shape and build the dry-run + confirmation token. **No order is placed in this checkpoint.**

**Touch.** `src/tools/translate.ts` (pure: `(action: buy|sell, side: yes|no, priceCents, count, tif)` → V2 `{ticker, side: bid|ask, price: dollarString, count: fp, time_in_force}`), `src/safety/caps.ts` (cost-basis cap math, rolling-24h daily from audit log), `src/safety/token.ts` (opaque confirmation token bound to exact params + short TTL), `src/tools/preview_order.ts` (validate → worst-case cost/exposure-after → cap check → issue token). Tests: **`test/translate.test.ts` (exhaustive truth table)**, `test/caps.test.ts`, `test/token.test.ts`, `test/preview_order.test.ts`.

**Look.** REFERENCES → Create order (V2) for the exact target shape; Fees for cost estimate; CONTEXT gotcha #2.

**Watch.** **THE bug surface.** V2 is YES-leg-only: `bid`=buy YES, `ask`=sell YES. **Buy NO = sell YES leg; sell NO = buy YES leg**, with price mirrored to the YES leg (NO @30¢ ⇒ YES leg @70¢). `time_in_force` required; "market" ⇒ IOC/FOK marketable, not a `type` field. Cost = **max loss = price × count** for the side you're long; cap is cost-basis, not payout. Token must bind to the precise normalized order so `place_order` can't drift.

**Done.** `test/translate.test.ts` asserts **all 8 combinations** (buy/sell × yes/no, plus limit vs market TIF) produce the correct `side`+`price`+`tif`, including the NO→YES-leg inversion and price mirror. Caps reject (not clamp) over-limit orders with a clear message; rolling-24h window correct. Token issues, validates, and **expires**. `preview_order` is `readOnlyHint: true` and moves no money. Server lists 6 tools.

---

## M5 — Execute: `place_order` (token-gated) + `cancel_order` + `cancel_all_orders` + audit + confirm

**Goal.** Place a resting limit order in **demo**, cancel it, kill-switch all. Full write path with the safety harness.

**Touch.** `src/safety/audit.ts` (append-only JSONL), `src/safety/confirm.ts` (MCP elicitation when supported + the preview-token gate as fallback), `src/tools/place_order.ts` (require valid unexpired token → `POST /portfolio/events/orders` → audit), `src/tools/cancel_order.ts`, `src/tools/cancel_all_orders.ts` (`GET resting` → batched `DELETE`), client mutation methods. Tests + a `KALSHI_DEMO_KEY`-gated integration test.

**Look.** REFERENCES → Create order (V2), Batch cancel (V2). CONTEXT gotcha #1 (V2 namespace only).

**Watch.** Mutation via `/portfolio/events/orders` **only** (legacy is dead). `place_order` MUST refuse without a valid token. Always set a `client_order_id` (UUID) for idempotent retries. Write the audit entry around the call. Elicitation may be unsupported on a host — fall back to the token gate, never hang, never auto-execute. `cancel_*` are `destructiveHint: true, idempotentHint: true`.

**Done.** Unit: place rejects bad/expired/missing token and cap violations; audit entries written; cancel paths build correct V2 requests (mocked). **Human demo smoke (one-time):** with a demo key, place a resting GTC limit far from market, see it via `get_orders`, `cancel_order` it, confirm `cancel_all_orders` clears resting orders. Server lists 9 tools.

---

## M6 — Context polish: server instructions + prompts

**Goal.** Make the conversation feel designed and well-grounded.

**Touch.** `src/server.ts` (fill `instructions`: cents=probability, settlement, fees, caps, the miscalibration caveat, "you decide size"), `src/prompts/analyze_market.ts`, `src/prompts/scan_opportunities.ts`, `src/prompts/review_positions.ts`.

**Look.** REFERENCES → MCP prompts; CONTEXT → four context layers.

**Watch.** Prompts are parameterized templates (e.g. `/analyze-market <ticker>`), not tool calls. Keep `instructions` tight and high-signal.

**Done.** Server `instructions` present and accurate. Three prompts register and render with params. Inspector shows them. Server lists 9 tools + 2 resources + 3 prompts.

---

## M7 — Live-mode gate + safety review

**Goal.** Make going live deliberate and safe; audit the whole surface.

**Touch.** `src/config.ts` (enforce: live needs `KALSHI_ENV=live` + a live key; `DISABLE_LIMITS` honored only with live; sports gated behind `ALLOW_SPORTS`), a startup banner stating env + active caps, a jurisdiction/sports caveat surfaced before the first live order. Tests for the gating matrix.

**Look.** ADR-0003 (safety) and ADR-0006 (demo-first); CONTEXT → safety harness.

**Watch.** Default must stay demo with zero config. No live order without the two acts. Re-scan for any path that logs secrets, any tool that bypasses the token gate or caps, any prompt-injection vector (a tool description or market text steering an unconfirmed trade).

**Done.** Gating matrix tested (demo default; live needs both acts; uncap needs the third). `npm run /security` mental checklist in this file passes: no secret in logs, no cap bypass, no un-gated mutation, audit covers all writes. Document the result in the commit.

---

## M8 — Distribution & docs

**Goal.** Anyone can `npx -y hunch-mcp` and wire it up in two minutes.

**Touch.** `package.json` (`bin`, `files`, shebang `#!/usr/bin/env node` at top of built `index.js` — add `#!/usr/bin/env node` to `src/index.ts`), README install snippets verified, `CONTRIBUTING.md`, a short demo script/GIF placeholder, `npm pack` dry-run check.

**Look.** REFERENCES → Claude Code MCP, Codex MCP. Distribution gotcha: `.mcp.json` args must be `["-y", "hunch-mcp"]` (the `-y` suppresses the npx install prompt that otherwise hangs startup).

**Done.** `npm pack` produces a clean tarball; `npx -y ./hunch-mcp-*.tgz` boots the server. README Claude Code + Codex snippets are copy-paste correct. Then the build is complete → `EXIT_SIGNAL: hunch v1 complete`.

---

## Out of scope (v2, do not build now)

Watcher daemon / conditional & stop-loss orders (ADR-0002), Polymarket or multi-venue, a web demo UI. Leave these as the documented roadmap.
