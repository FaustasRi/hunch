# AGENTS.md — operating manual for the build loop

You are an autonomous coding agent building **Hunch**. This file tells you how to work. Read [`CONTEXT.md`](CONTEXT.md) first for the domain and architecture, then this, then act on the **first unchecked item** in [`fix_plan.md`](fix_plan.md).

## The loop protocol

Each iteration starts with **no memory** of the last one — the **repository is the only state**. Progress lives in git history, the ticked boxes + Done log in [`fix_plan.md`](fix_plan.md), and any `## In progress` note there. [`LOOP.md`](LOOP.md) is the exact prompt to feed a loop runner each cycle; this is the rationale.

**0. Orient — always, before touching code.**
   - `git log --oneline -15` (what landed).
   - `npm install` if `node_modules` is missing, then `npm run verify` (current green/red state).
   - Read this file, skim [`CONTEXT.md`](CONTEXT.md), then read `fix_plan.md` (boxes, Done log, any `## In progress`).

**1. Decide your one task** (first match wins).
   - `npm run verify` **RED** → making it green again IS the task. Fix, commit, stop.
   - Else an `## In progress` note exists → resume and finish that checkpoint.
   - Else → the **first unchecked `[ ]`** checkpoint. Only that one. Never skip ahead.
   - All boxes `[x]` and verify green → print `EXIT_SIGNAL: hunch v1 complete` and stop. Invent no new work.

**2. Execute** the checkpoint per its [`docs/PLAN.md`](docs/PLAN.md) spec (goal, files, where to look, gotchas, DoD). Stay in scope — do not pull later work forward.

**3. Land.**
   - `npm run verify` (typecheck + lint + test + build) must be **green**.
   - Commit (Conventional Commit; end body with `Checkpoint: Mx`) and **push** to `main` (CI is the backstop).
   - Fully done → tick `[x]` and add a one-line Done-log entry; commit.
   - Stopping mid-checkpoint → write a precise `## In progress` note (done / remaining sub-bullets) and commit the WIP so the next iteration resumes cleanly.
   - **Stop.** Do not start the next checkpoint in the same iteration.

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

## Branch & CI/CD model

- **Direct to `main`.** The loop commits and pushes straight to `main` — no PR dance (autonomous loops deadlock waiting on PR/auto-merge). The gate is **local `npm run verify` before every commit**; keep `main` green.
- **CI** (`.github/workflows/ci.yml`) runs `npm ci && npm run verify` on every push and PR — the backstop and the public green/red signal. If CI is red, the next iteration's job is to green it (orient step catches it).
- **CD** (`.github/workflows/release.yml`) publishes to npm on a `v*` **tag** only — never on a normal commit. Cutting a release is a deliberate, separate act (see [`docs/RELEASING.md`](docs/RELEASING.md)); it requires the `NPM_TOKEN` repo secret. The build loop does **not** publish; it only lands code on `main`.

## Definition of done for v1

Every checkpoint box in `fix_plan.md` ticked, `npm run verify` green, the server boots over stdio and registers all 9 tools + 2 resources + 3 prompts, the demo path works end-to-end (verified by the human's one-time demo smoke test), the safety harness is proven by tests (cap rejection, token gating, demo default), and the README install snippets are accurate. Then `EXIT_SIGNAL`.
