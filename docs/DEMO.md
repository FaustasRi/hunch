# Hunch demo

> ![demo](demo.gif)
> <!-- TODO: record a ~20s GIF of the conversation below in Claude Code and drop it here as docs/demo.gif. -->

Hunch is **demo by default** — fake money, real Kalshi market mechanics. You can browse
markets with no key at all; placing (paper) trades needs a one-time demo key.

## One-time demo setup (~2 minutes)

1. Create a **demo** account at <https://demo.kalshi.co> (separate from production).
2. In the demo site, create an API key (Profile → API keys). You get a **key id** and a
   **private key** PEM — the PEM is shown once; save it.
3. Point Hunch at them via env (never commit these — see [`.env.example`](../.env.example)):

   ```bash
   export KALSHI_ENV=demo                       # the default; shown for clarity
   export KALSHI_API_KEY_ID=<your demo key id>
   export KALSHI_PRIVATE_KEY_PATH=./kalshi-demo-key.pem
   ```

   (Or store the PEM in the macOS Keychain; or inline it as `KALSHI_PRIVATE_KEY`.)

## Wire it into your agent

**Claude Code** — `.mcp.json` (the `-y` matters: it stops `npx` from hanging on an
install prompt at startup):

```json
{ "mcpServers": { "hunch": { "command": "npx", "args": ["-y", "hunch-mcp"], "env": { "KALSHI_ENV": "demo" } } } }
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.hunch]
command = "npx"
args = ["-y", "hunch-mcp"]
env = { KALSHI_ENV = "demo" }
```

## The conversation (also the manual smoke test)

1. **Balance** — "What's my Kalshi balance?" → `get_balance` returns your demo cash.
2. **Find a market** — "Find some open markets about the Fed." → `search_markets`.
3. **Get context** — "Give me the brief on `<ticker>`." → `get_market_brief` (rules,
   YES/NO prices, two-sided depth, recent trend).
4. **Preview** — "Preview buying 10 YES at 16¢ and resting it." → `preview_order` shows
   the wire order, max loss, exposure-after, the cap check, and returns a token.
5. **Place** — "Place it." → `place_order` (token-gated) rests a GTC limit far from
   market. Confirm it with "show my orders" → `get_orders`.
6. **Cancel** — "Cancel that order." → `cancel_order`. Then "cancel everything" →
   `cancel_all_orders` (the kill switch).

Every order and cancel is appended to the audit log (`AUDIT_LOG_PATH`, default
`./audit-log.jsonl`). Caps are enforced in demo too, so an over-cap order is rejected —
great for showing the guardrails on camera.

## Going live (deliberate, not default)

Live trading uses **real money** and takes two conscious acts: `KALSHI_ENV=live` **and**
a live key (from <https://kalshi.com>, separate from demo). Fully removing the caps takes
a third (`DISABLE_LIMITS=true`, honored only in live). Prediction-market legality is
US-state-dependent — you are responsible for compliance. See
[ADR-0003](adr/0003-safety-harness.md).
