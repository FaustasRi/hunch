# Contributing to Hunch

Thanks for taking a look. Hunch is a small, safety-first MCP server for Kalshi. The
bar is correctness and clarity over surface area — read [`CONTEXT.md`](CONTEXT.md) for
the domain and architecture and [`AGENTS.md`](AGENTS.md) for how the repo is built.

## Setup

```bash
npm install
npm run verify     # typecheck + lint + test + build — keep this green
npm run dev        # run the server over stdio (tsx watch)
npm run inspect    # open the MCP Inspector against the built server
```

You do **not** need a Kalshi key to build, test, or browse public market data — every
test runs against mocked responses. To exercise the live demo path, create a Kalshi
**demo** account + API key (see [`docs/DEMO.md`](docs/DEMO.md)) and set `KALSHI_API_KEY_ID`
+ `KALSHI_PRIVATE_KEY_PATH` (see [`.env.example`](.env.example)).

## Ground rules (non-negotiable)

These mirror [`AGENTS.md`](AGENTS.md) and exist because this tool can move money:

- **Mocked tests only.** Never block CI on a Kalshi key. A test that needs a real demo
  key must be `it.skipIf(!process.env.KALSHI_DEMO_KEY)(...)`.
- **Never place a live/real order from a test or CI.** Integration tests touch demo only.
- **Secrets never touch logs, git, or config files.** Load from env / macOS Keychain.
- **Caps reject, never clamp.** Order mutation goes only through the V2 namespace
  (`/portfolio/events/orders`). Verify endpoint shapes against `docs/REFERENCES.md` and
  the live docs before changing order code.
- **Zod-validate every tool input.** Keep the risky cores (signing, fixed-point, order
  translation, caps, token) pure and unit-tested.

## Pull requests

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
- `npm run verify` green and `npm run format` applied before pushing.
- Update the docs (CONTEXT / an ADR / PLAN) in the **same** change when you change a
  decision — this repo is led by its docs; stale docs are bugs.
- A new tool/resource/prompt needs an ADR update (the surface is deliberately tight —
  see [ADR-0005](docs/adr/0005-tool-surface.md)).

## Project layout

```
src/kalshi/    signing · client · fixed-point · types · V2 order endpoints
src/safety/    caps · confirmation token · audit log · elicitation confirm
src/tools/     one file per tool (register(server, ctx)); translate.ts is the riskiest core
src/resources/ kalshi://market/{ticker} · kalshi://portfolio
src/prompts/   /analyze-market · /scan-opportunities · /review-positions
test/          mocked unit/contract tests + fixtures (one gated demo integration test)
```
