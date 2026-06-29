# REFERENCES — where to look for info

Curated from research (June 2026). **Always re-verify against the live pages** — Kalshi's API moved to V2 and deprecated legacy order endpoints in 2026, so training memory is stale. When docs and memory disagree, docs win.

## Kalshi API

| Topic | URL | Notes |
| --- | --- | --- |
| Docs home / changelog | https://docs.kalshi.com · https://docs.kalshi.com/changelog | **Check the changelog** — V2 launched Apr 2026; legacy order mutation deprecated Jun 18–25 2026. |
| Auth (request signing) | https://docs.kalshi.com/getting_started/quick_start_authenticated_requests | RSA-PSS, headers, signed string. See snippet below. |
| API keys / demo | https://docs.kalshi.com/getting_started/api_keys | Demo + prod keys are separate; key shown once. |
| Get markets (discovery) | https://docs.kalshi.com/api-reference/market/get-markets | Filters: `status`, `series_ticker`, `event_ticker`, `tickers`, `limit`, `cursor`. |
| Get market (detail) | https://docs.kalshi.com/api-reference/market/get-market | `rules_primary`, prices `*_dollars`, `volume_fp`, `open_interest_fp`, `close_time`, `series_ticker`. |
| Get order book | https://docs.kalshi.com/api-reference/market/get-market-orderbook | `orderbook_fp.{yes_dollars,no_dollars}` = arrays of `[price, count]`. **Bids only** on each leg. |
| Candlesticks | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | Path needs `series_ticker`. Required `start_ts`,`end_ts`,`period_interval` (1/60/1440). |
| **Create order (V2)** | https://docs.kalshi.com/api-reference/orders/create-order-v2 | `POST /portfolio/events/orders`. `side` bid/ask, `price` dollar-string, `count` fp-string, `time_in_force` required. **Use this, not legacy.** |
| **Batch cancel (V2)** | https://docs.kalshi.com/api-reference/orders/batch-cancel-orders-v2 | `DELETE /portfolio/events/orders/batched`. Backs `cancel_all_orders`; 1-element = single cancel fallback. |
| Get orders (read) | https://docs.kalshi.com/api-reference/orders/get-orders | `GET /portfolio/orders` — the READ still lives on legacy path and is fine. |
| Balance / positions / fills | https://docs.kalshi.com/python-sdk/api/PortfolioApi | `GET /portfolio/balance`,`/positions`,`/fills`. `realized_pnl`, `exposure`, `fill_count_fp`. |
| Rate limits | https://docs.kalshi.com/getting_started/rate_limits | Token bucket; most calls 10 tokens; batch cancel 2/order. Back off. |
| Fees | https://kalshi.com/docs/kalshi-fee-schedule.pdf | taker ≈ `7¢ × C × (1−C)`; maker/resting often exempt. For preview cost. |
| Official signer reference (Python) | https://github.com/Kalshi/kalshi-starter-code-python/blob/main/clients.py | Read for the **signing algorithm** even though we implement in Node. |

### Hosts (make configurable; default demo)

- Demo REST: `https://demo-api.kalshi.co/trade-api/v2`
- Prod REST: `https://api.elections.kalshi.com/trade-api/v2` (newest docs also show `https://external-api.kalshi.com/trade-api/v2` — verify which resolves for the account).

### The RSA-PSS signer (Node, native — no dependency)

`src/kalshi/signing.ts` implements exactly this. Message = `timestamp_ms + METHOD + path`, where `path` includes `/trade-api/v2` and **excludes** the query string.

```ts
import { createSign, constants, sign as _sign } from 'node:crypto';

export function signKalshiRequest(
  privateKeyPem: string,
  timestampMs: string, // Date.now().toString()
  method: string,      // 'GET' | 'POST' | 'DELETE'
  path: string,        // e.g. '/trade-api/v2/portfolio/balance' (NO query string)
): string {
  const msg = Buffer.from(timestampMs + method.toUpperCase() + path, 'utf8');
  const signature = _sign('sha256', msg, {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    // MGF1 defaults to the signature digest (SHA-256) — exactly what Kalshi wants.
  });
  return signature.toString('base64');
}
// Headers: KALSHI-ACCESS-KEY (key id), KALSHI-ACCESS-TIMESTAMP (ms), KALSHI-ACCESS-SIGNATURE (the base64 above).
```

## MCP

| Topic | URL |
| --- | --- |
| Spec home | https://modelcontextprotocol.io |
| TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk · `docs/server.md` |
| Tools + annotations | https://modelcontextprotocol.io/specification (tool `annotations`: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) |
| Elicitation (confirm dialogs) | https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation — note: form-mode MUST NOT request secrets. |
| Resources | https://modelcontextprotocol.io (resources) — for `kalshi://market/{ticker}` |
| Prompts | https://modelcontextprotocol.io (prompts) — for `/analyze-market` etc. |
| Inspector (manual test) | `npx @modelcontextprotocol/inspector node dist/index.js` |
| Claude Code MCP | https://code.claude.com/docs/en/mcp |
| Codex MCP | https://developers.openai.com/codex/mcp (table name is `mcp_servers`, underscore) |

## Reference implementations to study (do not copy wholesale)

- `alpacahq/alpaca-mcp-server` — official trading MCP; **paper-trade default** pattern, clean order core (ignore its ~65-tool data fan-out — that's the bloat lesson).
- `alexandermazza/kalshi-trading-mcp` — the `prepare_order → confirm_order` safety pattern + price/daily caps (its weather tools are a vertical; ignore).
- `pmxt-dev/pmxt` (`@pmxt/mcp`) — staged `buildOrder → submitOrder` + `getExecutionPrice` cost preview; unified order schema.
- `9crusher/mcp-server-kalshi` — minimal honest Kalshi baseline.

## Background research (design rationale)

The decisions in `docs/adr/` are backed by a multi-agent research pass: Kalshi/Polymarket API mechanics, the resting-order vs watcher split, MCP host integration, the competitive landscape, regulatory/safety reality, the TS-vs-Python stack call, and the tool-surface mapping. Summaries live in the ADRs; this file is the operational index.
