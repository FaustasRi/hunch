# ADR-0002 — Two-tier architecture: MCP now, watcher daemon later

**Status:** Accepted (2026-06-29)

## Context
The vision includes "plan buys/sells" — conditional logic like stop-loss, "sell if it hits 80¢", scheduled DCA. Research shows Kalshi (and Polymarket) order APIs are **limit-only** — no native stop/trigger/conditional order types. Separately, "buy at 16¢ and walk away" is just a **resting GTC limit order the exchange holds** — needing no client process. And an MCP server / LLM is **request-scoped**: it only runs when invoked, so it cannot be a live price-watch loop (Claude Code's scheduled routines have a ≥1-hour floor — useless for a stop-loss).

## Decision
Split into two tiers, ship only **Tier 1** in v1:
- **Tier 1 (v1, this repo):** the MCP — reads + resting limit/market orders + safety harness. Native resting orders cover all static-price "set and forget" cases with **no daemon**.
- **Tier 2 (v2, designed only):** a small standalone always-on **watcher daemon** that subscribes to prices and fires a marketable order when a user-authored rule trips. Claude *authors* the rule; the dumb daemon *enforces* it. Not built in v1.

## Consequences
- v1 is a clean, finishable, daemon-free artifact; the headline "buy at 16¢ and walk away" works immediately.
- Conditional orders are a documented, ADR-backed v2 — itself a maturity signal.
- Keep the rule-spec boundary in mind so Tier 2 can attach later without reshaping Tier 1.
