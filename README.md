# Hunch

[![CI](https://github.com/FaustasRi/hunch/actions/workflows/ci.yml/badge.svg)](https://github.com/FaustasRi/hunch/actions/workflows/ci.yml)

**Talk to Claude (or Codex) about [Kalshi](https://kalshi.com) prediction markets — and place trades by conversation.**

> _A hunch, not a certainty._ Hunch surfaces the market price, the news, and the base rate, then executes the bet **you** decide on — with hard guardrails and a paper-money default. It does **not** try to pick winners for you (see [Why Hunch won't autopick](#why-hunch-wont-autopick)).

> 🚧 **Status: in active build.** This repository is scaffolded and built incrementally by a **stateless autonomous agent loop** — each iteration orients from the repo, completes one checkpoint, and hands off via git. The loop prompt is [`LOOP.md`](LOOP.md); the plan is [`docs/PLAN.md`](docs/PLAN.md); progress is [`fix_plan.md`](fix_plan.md). CI on every push, CD to npm on version tags.

Hunch is an [MCP](https://modelcontextprotocol.io) server. It exposes Kalshi as a small, safe set of tools your AI coding agent can call — so you can have a normal conversation:

> _"What are the odds the Fed cuts in September?"_ → _"Show me the order book."_ → _"Put $20 on YES at 16¢ and rest it."_

## Why prediction markets

On Kalshi the **price is the probability**: a contract at 16¢ means the market thinks the event is ~16% likely, and pays $1 if it happens. That makes conversational, opinion-driven trading a natural fit for an LLM — it reasons over news and base rates, not chart squiggles. And **"buy at 16¢ and walk away" is just a resting limit order** the exchange holds for you — no always-on bot required.

## Safety first (this is the point)

- **Demo by default.** Out of the box Hunch points at Kalshi's [demo environment](https://demo.kalshi.co) — fake money, real market mechanics. Anyone can clone it and play with **zero money and zero risk.**
- **Going live takes two conscious acts:** `KALSHI_ENV=live` _and_ a live API key. Never inferable from a single prompt.
- **Preview → place.** Orders are structurally two-step: `preview_order` (read-only, prices the trade + issues a token) then `place_order` (executes only with that token). The model cannot fat-finger a live trade.
- **Hard caps in code** (`MAX_ORDER_USD`, `MAX_DAILY_USD`, `MAX_OPEN_EXPOSURE_USD`) — orders over the cap are **rejected, not clamped**, regardless of what the model says.
- **Append-only audit log** of every proposed / placed / cancelled order.
- **Kill switch:** `cancel_all_orders`.

## Quick start

```bash
# (once published)
npx -y hunch-mcp        # runs the MCP server over stdio
```

**Claude Code** — `.mcp.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "hunch": {
      "command": "npx",
      "args": ["-y", "hunch-mcp"],
      "env": { "KALSHI_ENV": "demo" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.hunch]
command = "npx"
args = ["-y", "hunch-mcp"]
env = { KALSHI_ENV = "demo" }
```

Credentials go in the environment or macOS Keychain — never in these files. See [`.env.example`](.env.example) and [`AGENTS.md`](AGENTS.md).

To actually trade (even demo), you need a Kalshi **demo** account + API key — a one-time, ~2-minute setup documented in [`docs/PLAN.md`](docs/PLAN.md).

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `search_markets` | read | Find markets by status / series / event / text |
| `get_market_brief` | read | Rich one-shot context for a market (rules, prices, order-book depth, recent trend) |
| `get_balance` | read | Cash + portfolio value |
| `get_positions` | read | Open positions with exposure |
| `get_orders` | read | Your resting / recent orders |
| `preview_order` | read | Dry-run: cost, worst-case fill, exposure-after, cap check → confirmation token |
| `place_order` | **write** | Execute (token-gated). `"buy YES at 16¢"` = a resting GTC limit |
| `cancel_order` | **write** | Cancel one resting order |
| `cancel_all_orders` | **write** | Kill switch |

Plus MCP **resources** (`kalshi://market/{ticker}`, `kalshi://portfolio`) and **prompts** (`/analyze-market`, `/scan-opportunities`, `/review-positions`).

## Why Hunch won't autopick

LLMs are systematically **miscalibrated** on probabilities and most overconfident exactly when wrong. A binary YES/NO market turns that into a directional bet against sharper counterparties in a negative-sum game (after fees and spread). "Let the AI find good bets" quietly loses money. Hunch's edge is the **interface and the discipline** — fast research, clean execution, caps, an audit trail — with judgment kept by the human. We say so out loud, in the server's own instructions.

## Roadmap

- **v1 (this build):** the Kalshi MCP above, demo-first, full safety harness. See [`docs/PLAN.md`](docs/PLAN.md).
- **v2 (designed, not built):** an optional always-on **watcher daemon** for conditional orders (stop-loss, "sell if it hits 80¢", scheduled DCA) — things Kalshi's API can't do natively and an MCP can't host. See [`docs/adr/0002-two-tier-architecture.md`](docs/adr/0002-two-tier-architecture.md).
- Later: multi-venue **reads** (Polymarket, Manifold), a web demo.

## License

MIT © Faustas Rinkevicius. Not affiliated with Kalshi Inc. Nothing here is financial advice; you are solely responsible for trades placed with your own keys.
