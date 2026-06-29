# CONTEXT — Hunch

> Read this first, then [`AGENTS.md`](AGENTS.md), then the top unchecked item in [`fix_plan.md`](fix_plan.md).
> This file is the shared language and the architecture. If you make a decision that contradicts it, update this file in the same commit (see [feedback: lead, don't be managed](#how-this-doc-relates-to-the-code)).

## What Hunch is

An [MCP](https://modelcontextprotocol.io) server, written in TypeScript, that lets an AI agent (Claude Code, Codex) **read Kalshi prediction markets and place trades on the user's own account** through a small, safe tool surface. The product value is a *calm, conversational, safety-railed* way to trade your own convictions — **not** an alpha-generating autotrader. Demo (fake money) is the default; live trading is a deliberate opt-in.

## Domain glossary (Kalshi)

- **Kalshi** — a US, CFTC-regulated prediction-market exchange (a Designated Contract Market). Has an official REST + WebSocket API and a full **demo** environment.
- **Event contract** — a binary contract that settles **$1 if the event happens, $0 if not.**
- **Price = probability.** Prices are quoted 1–99¢ (now also as fixed-point **dollar strings**, e.g. `"0.16"`). 16¢ ≈ "16% likely". "Buy YES at 16¢" risks 16¢/contract to win 84¢.
- **Market / Event / Series.** A **Market** is one tradable contract (carries the resolution **rules**, prices, status). An **Event** groups related markets (metadata only). A **Series** is a recurring template/category (metadata only). → For v1, **resolution rules live on the Market**; we do not need separate event/series tools.
- **YES / NO.** Two sides of a market. NO at price `p` is the mirror of YES at `1−p`.
- **Resting limit order** — an unfilled limit order the **exchange holds** until filled / cancelled / expired. With `time_in_force=good_till_canceled` it is a true GTC order. **This is how "buy at 16¢ and walk away" works — no daemon.** Resting (maker) orders are fee-exempt or discounted.
- **Time-in-force:** `good_till_canceled` (GTC, rests), `immediate_or_cancel` (IOC), `fill_or_kill` (FOK). There is **no `type=market` field** in the V2 order shape — a "market order" is expressed as IOC/FOK at a marketable price.
- **Fixed-point strings.** The V2 API uses dollar strings (`price: "0.1500"`, up to 6 decimals) and `_fp` count/volume strings — **not integer cents.** Parse/format carefully; mixing string and number causes silent precision bugs.
- **Demo vs prod.** Different hosts **and different API keys.** Demo: `https://demo-api.kalshi.co/trade-api/v2`. Prod: `https://api.elections.kalshi.com/trade-api/v2` (newer docs also show `external-api.kalshi.com`). Demo prices are not real markets. Make the base URL + env explicit and hard to confuse.
- **Auth = RSA-PSS request signing** (not a bearer token). Every authenticated call sends `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP` (unix **ms**), `KALSHI-ACCESS-SIGNATURE`. The signature signs the string `timestamp + METHOD + path` where `path` **includes** `/trade-api/v2` and **excludes** the query string. Algorithm: RSA-PSS, SHA-256, MGF1-SHA256, salt length = digest length. See [`docs/REFERENCES.md`](docs/REFERENCES.md) for the exact Node implementation.

## Architecture

```
AI host (Claude Code / Codex)
        │  MCP (JSON-RPC over stdio)
        ▼
┌─────────────────────────────────────────────┐
│ Hunch MCP server  (@modelcontextprotocol/sdk)│
│  • server instructions (domain + caveats)    │
│  • tools (9)   • resources (2)  • prompts (3) │
│  • safety harness: caps · preview-token ·     │
│    confirm · audit log                        │
│              │                                │
│              ▼                                │
│  Kalshi client (thin, typed)                  │
│   • RSA-PSS signer (native node:crypto)       │
│   • demo host by default                      │
│   • fixed-point <-> number helpers            │
└─────────────────────────────────────────────┘
        │ HTTPS (signed)
        ▼
   Kalshi REST API v2  (demo or prod)
```

### Two tiers (only Tier 1 is in v1)

- **Tier 1 — the MCP (this repo, v1).** Reads + resting limit/market orders + the safety harness. Covers ~90% of the vision, including "buy at 16¢ and walk away", with **no always-on process** — the exchange holds resting orders.
- **Tier 2 — a watcher daemon (v2, designed only).** Conditional logic (stop-loss, "sell if it hits 80¢", scheduled DCA) that Kalshi's API can't express and an MCP can't host (MCP is request-scoped). A small separate always-on process. See [`docs/adr/0002-two-tier-architecture.md`](docs/adr/0002-two-tier-architecture.md). **Do not build it in v1.**

### The four context layers (how the agent gets "great context")

1. **Server `instructions`** — domain primer baked into the server (cents=probability, settlement, fees, the miscalibration caveat, the caps). Every host gets it for free.
2. **`get_market_brief` tool** — one dense, LLM-optimized payload per market (rules, YES/NO bid/ask/last, order-book depth, volume/OI, close time, recent trend). The context keystone.
3. **Resources** — `kalshi://market/{ticker}`, `kalshi://portfolio` for attachable live state.
4. **Prompts** — `/analyze-market`, `/scan-opportunities`, `/review-positions` as slash-command-style conversation starters.

### Tool surface (9) — see [ADR-0005](docs/adr/0005-tool-surface.md)

Reads: `search_markets`, `get_market_brief`, `get_balance`, `get_positions`, `get_orders`, `preview_order`.
Writes: `place_order`, `cancel_order`, `cancel_all_orders`.

**Discovery is event-based.** Kalshi has no server-side text search and there are 10,000+ open markets, and a **market carries no title/category/series** — only the **event** does. So `search_markets`' free-text mode searches/ranks **events** (by title + series + category), then expands the best events into concrete markets; it also browses by `category` and drills in by `event_ticker`/`series_ticker`. A literal one-page market scan (the v1 approach) silently missed almost everything (e.g. "bitcoin" → 0 hits while 58 bitcoin events existed). See `src/kalshi/discovery.ts` + `src/tools/search_markets.ts`.

**The preview→place contract:** `preview_order` is read-only — it validates the intended order, computes worst-case cost / exposure-after, runs the cap check, and returns an **opaque confirmation token** (bound to the exact order params, short TTL). `place_order` **requires a valid, unexpired token** and refuses raw orders. This makes an un-previewed live trade structurally impossible.

### Safety harness — see [ADR-0003](docs/adr/0003-safety-harness.md)

- Demo default; live needs `KALSHI_ENV=live` + a live key; fully uncapping needs a third act (`DISABLE_LIMITS=true` + live).
- Caps enforced **in code**, **reject not clamp**, measured as **cost basis = max loss** (YES @16¢ → $0.16/contract risk, not $1). `MAX_DAILY_USD` is a **rolling 24h** window from the audit log. Caps apply in demo too (exercises the code path; great for the demo GIF).
- `place_order`/`cancel_*` additionally fire MCP **elicitation** confirmation when the host supports it, with a **non-elicitation fallback** (the preview token IS the fallback gate) so trades never silently execute *or* hang.
- Every order proposal/placement/cancel/fill → **append-only JSONL audit log** with timestamp, params, rationale, env.

## The load-bearing gotchas (get these wrong → real bugs)

1. **Order mutation goes through the V2 namespace only.** `POST /portfolio/events/orders`, batch cancel `DELETE /portfolio/events/orders/batched`. The legacy `/portfolio/orders` create/cancel/amend/decrease endpoints were **deprecated June 2026** and now error. Only the **GET** read on `/portfolio/orders` still works. Always re-verify against the live docs.
2. **V2 create is YES-leg-only.** Body: `side` = `bid` (buy YES) / `ask` (sell YES), a single `price` dollar-string, `count` (`_fp` string), `time_in_force` (required). There is **no** `action` / `yes_price` / `no_price` / `type`. **"Buy NO" = sell the YES leg.** The translation `(action buy|sell × side yes|no × cents)` → `(bid|ask + dollar price + TIF)` is the **single riskiest correctness surface** — get it wrong and you trade the opposite side. It must have an exhaustive truth-table test ([`test/translate.test.ts`](test/translate.test.ts)).
3. **Order book is bids-only on both legs.** A YES bid at `p` equals a NO ask at `1−p`. Derive ask depth from the opposite leg; don't render a naive two-sided book.
4. **Candlesticks need `series_ticker` in the path** (`/series/{series}/markets/{ticker}/candlesticks`). `get_market_brief` must resolve `series_ticker` first.
5. **Fixed-point dollar strings everywhere** on the v2 surface. Use the helpers in `src/kalshi/fixedpoint.ts`; never `parseFloat` ad hoc.
6. **Secrets** (API key id + RSA private key) load from Keychain/env only; never logged, never in `.mcp.json`/`config.toml`/git.

## Non-goals (v1)

- No autopicking / "find me winning bets" (calibration trap — see README).
- No watcher daemon / conditional orders (that's v2).
- No Polymarket, no multi-venue (Kalshi only).
- No web UI (the MCP is headless; a web demo is a later nice-to-have, hence TypeScript).

## How this doc relates to the code

This repo is **led by its docs, not governed by them.** If the right implementation choice contradicts CONTEXT/an ADR, make the choice and update the doc (or add an ADR) in the **same commit**. Stale docs are bugs.
