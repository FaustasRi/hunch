# ADR-0004 — Order mutation via the Kalshi V2 namespace only

**Status:** Accepted (2026-06-29)

## Context
Kalshi launched a V2 order API (Apr 2026) and **deprecated the legacy `/portfolio/orders` mutation endpoints** (create/cancel/amend/decrease) in the June 18–25 2026 window; they were rate-penalized first, then made to error ("Please switch to the V2 endpoints"). The legacy **GET read** on `/portfolio/orders` still works. Training memory predating this will reach for the dead endpoints.

The V2 create shape is also different: **YES-leg-only** — `side` = `bid` (buy YES) / `ask` (sell YES), a single `price` as a fixed-point **dollar string**, `count` as an `_fp` string, and `time_in_force` is **required** (no `type=market`; a market order is IOC/FOK at a marketable price).

## Decision
- All order **mutation** goes through `POST /portfolio/events/orders` and batch cancel `DELETE /portfolio/events/orders/batched`. Single cancel uses the V2 single-delete (verify exact path against live docs; else a 1-element batched delete).
- Keep order **reads** on `GET /portfolio/orders`.
- A dedicated, exhaustively-tested translation layer maps conversational `(buy/sell × yes/no × cents)` to the YES-leg `(bid/ask + dollar price + TIF)` shape. **Buy NO = sell YES leg, price mirrored.**

## Consequences
- The translation layer is the single riskiest correctness surface → exhaustive truth-table tests (PLAN M4).
- Always re-verify endpoint shapes against live docs before shipping order code.
