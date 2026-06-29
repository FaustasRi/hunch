# ADR-0001 — Stack: TypeScript + reference MCP SDK

**Status:** Accepted (2026-06-29)

## Context
Choosing the implementation language for the Hunch MCP server. Candidates: Python (FastMCP, Kalshi Python starter) vs TypeScript (`@modelcontextprotocol/sdk`). Researched both.

Findings: SDK/elicitation support is at parity. The "Python already has the RSA-PSS signer" advantage is **neutralized** — Node's built-in `crypto` reproduces Kalshi's exact RSA-PSS / SHA-256 / MGF1 / salt=digest scheme natively in ~10 lines. `npx` and `uvx` distribution are near-parity (`npx` rides on Node, a hair lower-friction for "free for everyone"). The deciding factor is **web-demo synergy**: a single TS repo can share the Kalshi client + types between the MCP server and a future landing/demo page; Python would need a duplicated JS client.

## Decision
**TypeScript**, on the reference **`@modelcontextprotocol/sdk`** (not a community wrapper — direct control of tools/resources/prompts/elicitation, and it signals genuine protocol mastery for a portfolio piece). Native `node:crypto` for signing (zero crypto deps). Distribute via `npx -y` from npm. Monorepo-friendly layout leaving room for a `web/` demo later.

## Consequences
- One typed codebase for server (and eventual web demo).
- Must hand-wrap a thin Kalshi client (the generated TS SDK is verbose) — acceptable, and yields a cleaner tool surface.
- Node ≥ 20 required.
