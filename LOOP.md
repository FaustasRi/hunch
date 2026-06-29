# LOOP.md — the per-iteration prompt for the autonomous build loop

This is the **exact prompt** to feed a loop runner (Ralph, Claude Code `/loop`, cron) on **every** cycle, verbatim. Each iteration starts with **no memory of previous iterations** — the repository is the only source of truth. Run the loop in a **single checkout** of this repo.

---

You are one iteration of an autonomous build loop for **Hunch**. You have no memory of prior iterations. The git repository is your only state. Do exactly one unit of work, leave the repo clean and green, then stop.

**0 — ORIENT (always, before touching code):**
- `git log --oneline -15`
- `npm install` only if `node_modules` is missing, then `npm run verify`
- Read `AGENTS.md`, skim `CONTEXT.md`, then read `fix_plan.md` (boxes, the Done log, and any `## In progress` note).

**1 — DECIDE your single task (first match wins):**
- If `npm run verify` is **RED** → making it green again is your task.
- Else if `fix_plan.md` has an `## In progress` note → resume and finish that checkpoint.
- Else → take the **first unchecked `[ ]`** checkpoint in `fix_plan.md`. Only that one. Never skip ahead.
- If all boxes are `[x]` and verify is green → print `EXIT_SIGNAL: hunch v1 complete` and STOP. Do nothing else.

**2 — EXECUTE (one checkpoint only):**
- Read its full spec in `docs/PLAN.md` (goal, files, where to look, gotchas, Definition of Done).
- Implement it. Obey the hard rules in `AGENTS.md`: mocked tests, **never block on a Kalshi key**, **never place a live/real order from tests or CI**, secrets never in logs/git, caps **reject not clamp**, **demo is the default**. Re-verify endpoint shapes against the live docs in `docs/REFERENCES.md` (Kalshi moved to a V2 order API in 2026 — memory is stale).

**3 — LAND:**
- `npm run verify` MUST be green. Fix what you broke.
- Commit (Conventional Commit; end the body with `Checkpoint: Mx`) and `git push` (the loop works on `main`; CI is the backstop).
- If the checkpoint is **fully done**: tick its `[x]` box and add a one-line entry to the Done log in `fix_plan.md`; commit that too.
- If you must **stop mid-checkpoint**: replace the `## In progress` section in `fix_plan.md` with a precise note (what's done / what remains, as sub-bullets) and commit the WIP — so the next iteration resumes cleanly.
- **STOP.** Do not start the next checkpoint in this iteration.

---

That's it. One oriented, verified, committed unit of work per iteration. The combination of (a) ticked boxes + Done log, (b) git history, and (c) the `## In progress` note is what lets a memoryless next agent always pick up exactly where this one left off.
