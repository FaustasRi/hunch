# ADR-0005 — Tool surface (9 tools)

**Status:** Accepted (2026-06-29)

## Context
Calibrated against real Kalshi API resource layout, MCP tool-design idioms, and best-in-class trading MCP taxonomies (Alpaca official ~65 tools = the bloat lesson; alexandermazza/PMXT = the prepare/confirm pattern; the convergent core all servers share = balance, positions, discovery, market detail, open orders, place, cancel). Too many tools degrade model tool-selection; keep it tight.

## Decision
Exactly **9 tools** + 2 resources + 3 prompts.

**Reads** (`readOnlyHint`): `search_markets`, `get_market_brief`, `get_balance`, `get_positions`, `get_orders`, `preview_order`.
**Writes** (`destructiveHint`): `place_order`, `cancel_order`, `cancel_all_orders` (cancels are also `idempotentHint`).

Deliberately **not** built: separate `get_event` / `get_series` (discovery folds into `search_markets` filters; rules live on the Market), separate `get_orderbook` / `get_market_history` (folded into `get_market_brief`), `get_fills` / `get_pnl` (derivable from positions/orders), `amend_order` / `decrease_order` / batch-create (cancel-and-replace covers conversational editing — defer to v2).

`preview_order`/`place_order` implement the token-gated two-step (ADR-0003). `get_market_brief` is the rich-context keystone (CONTEXT → four context layers).

## Consequences
- Surface stays complete-feeling but tight; the heavy engineering is in `get_market_brief` aggregation and the order translation, not in tool count.
- New tools require an ADR update.
