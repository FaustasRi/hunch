// Judge a vitest TAP run from its streamed output. Used in CI because vitest
// streams per-file `ok`/`not ok` lines during the run but then never exits on the
// Linux runner (teardown hang, before any onFinished). We `timeout`-kill the zombie
// and decide here. Honest: any `not ok` -> fail; an incomplete run -> fail.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const out = readFileSync(file, 'utf8');
const lines = out.split('\n');

const planLine = lines.find((l) => /^\d+\.\.\d+$/.test(l.trim()));
const expected = planLine ? Number(planLine.trim().split('..')[1]) : 0;
const ok = lines.filter((l) => /^ok \d+/.test(l)).length;
const notOk = lines.filter((l) => /^not ok \d+/.test(l)).length;

console.log(`[check-tap] plan=${expected} ok=${ok} not_ok=${notOk}`);

if (notOk > 0) {
  console.error('[check-tap] FAIL — one or more test files reported failures');
  process.exit(1);
}
if (expected === 0 || ok < expected) {
  console.error(`[check-tap] FAIL — run incomplete (got ${ok}/${expected} results before exit)`);
  process.exit(1);
}
console.log('[check-tap] PASS — all test files green');
process.exit(0);
