# AGENTS.md — operating manual for the build loop

You are an autonomous coding agent building **Hunch**. This file tells you how to work. Read [`CONTEXT.md`](CONTEXT.md) first for the domain and architecture, then this, then act on the **first unchecked item** in [`fix_plan.md`](fix_plan.md).

## The loop protocol

1. Open [`fix_plan.md`](fix_plan.md). Find the **first unchecked `[ ]` checkpoint**. That is your task — _only that one_.
2. Open the matching section in [`docs/PLAN.md`](docs/PLAN.md) for the full spec: goal, files to touch, where to look, gotchas, and **Definition of Done (DoD)**.
3. Implement it. Stay inside the checkpoint's scope — do not pull work forward from later checkpoints.
4. **Verify:** run `npm run verify` (typecheck + lint + test + build). It must be **green**. Fix what you broke.
5. **Commit** with a Conventional Commit message (see below). One checkpoint = one (or a few tightly-related) commits.
6. **Tick the box** `[x]` in `fix_plan.md` and add a one-line note of what landed.
7. Stop (or, in a continuous loop, proceed to the next unchecked item).
8. **Exit condition:** when every box in `fix_plan.md` is `[x]`, the build is done — print `EXIT_SIGNAL: hunch v1 complete` and stop. Do not invent new work.

## Hard rules (non-negotiable)

- **Never block on a live Kalshi key.** All unit/contract tests run against **mocked** Kalshi responses (fixtures in `test/fixtures/`). Any test needing a real demo key MUST be written as `it.skipIf(!process.env.KALSHI_DEMO_KEY)(...)` so the loop stays green without one. The human runs the live demo smoke test separately (see PLAN M1/M5).
- **Never place a real or live order from a test or from CI.** Integration tests touch **demo only**, and only when a demo key is present. `KALSHI_ENV` defaults to `demo`; live requires an explicit flag (see CONTEXT → safety harness).
- **Secrets never touch logs, git, or config files.** Load from env / macOS Keychain. If you log a request, redact the signature and key. `.env`, `*.pem`, `*.key` are gitignored — keep it that way.
- **Caps reject, never clamp.** An order over a cap returns a clear error; it is not silently shrunk.
- **Every order action writes the audit log** before/after the API call.
- **Build before you commit.** Never commit code that doesn't `npm run verify` green. Verify API field names against `src/kalshi/types.ts` (and the live docs) — do not guess endpoint shapes.
- **Zod-validate every tool input.** No unvalidated args reach the Kalshi client.
- **Demo is the default everywhere.** Pointing at prod must be an explicit, obvious, opt-in act.

## Where to look for info

- **[`docs/REFERENCES.md`](docs/REFERENCES.md)** — every Kalshi + MCP doc URL you need, the exact endpoints per tool, and the Node RSA-PSS signer snippet. Start here.
- **Kalshi moved to a V2 order API in 2026 and deprecated the legacy order endpoints.** Treat your training memory as possibly stale: re-verify endpoint shapes against `https://docs.kalshi.com` (and the changelog) before wiring orders. When docs and memory disagree, docs win.
- **MCP SDK:** the reference TypeScript SDK `@modelcontextprotocol/sdk` and the spec at `https://modelcontextprotocol.io`. Use `registerTool` / `registerResource` / `registerPrompt`; use the spec's tool **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and `outputSchema` where it adds clarity.
- **The gotchas** are enumerated in CONTEXT → "load-bearing gotchas". Re-read them before M2 (reads), M4 (translation/preview), and M5 (orders).
- **Context7 MCP** (if available) is good for fetching current `@modelcontextprotocol/sdk` and `zod` docs. Prefer it over memory for library APIs.

## Coding conventions

- TypeScript, `"type": "module"`, NodeNext ESM. `strict` is on (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Respect it.
- Imports use explicit `.js` extensions (NodeNext): `import { x } from './foo.js'`.
- One tool per file in `src/tools/`, exporting a `register(server, ctx)` function. The server factory wires them.
- Pure, testable cores: keep the Kalshi client, the fixed-point helpers, the order translation, and the cap math as **pure functions** with their own unit tests. Side effects (HTTP, audit log, elicitation) live at the edges.
- Errors surfaced to the model are **actionable strings** ("order rejected: $40 exceeds MAX_ORDER_USD=$25"), not stack traces.
- Match the existing file's style. Run `npm run format` before committing.

## Commit & PR discipline

- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`. Scope by area when useful: `feat(tools): add get_market_brief`.
- Reference the checkpoint: end the body with `Checkpoint: M3`.
- Keep commits green and self-contained. Update docs (CONTEXT/ADR/PLAN) in the **same commit** as the code that changes a decision — this repo is led by its docs, not governed by them; stale docs are bugs.
- Do **not** add AI-attribution/co-author trailers unless the operator's global config asks for them.

## Definition of done for v1

Every checkpoint box in `fix_plan.md` ticked, `npm run verify` green, the server boots over stdio and registers all 9 tools + 2 resources + 3 prompts, the demo path works end-to-end (verified by the human's one-time demo smoke test), the safety harness is proven by tests (cap rejection, token gating, demo default), and the README install snippets are accurate. Then `EXIT_SIGNAL`.
