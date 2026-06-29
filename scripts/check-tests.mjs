// Judge a vitest run from the DEFAULT reporter's streamed per-file lines.
//
// Why: on the GitHub Linux runner vitest never exits (teardown hang, before any
// reporter onFinished / final summary). The default reporter does STREAM a line
// per file as it finishes (the tap/json/custom reporters emit nothing in CI), so
// CI runs `timeout … vitest run > test.out` (kills the zombie) and we decide here.
//
// Per-file lines look like:  " ✓ test/x.test.ts (7 tests) 6ms"
//                            " ❯ test/x.test.ts (1 test | 1 failed) 7ms"
//                            " ↓ test/x.test.ts (2 tests | 2 skipped)"
// Failing tests print:       "   × suite > name 5ms"
//
// Honest: any failure marker -> fail; fewer file lines than test files on disk
// (run didn't finish before the timeout kill) -> fail.
import { readFileSync, globSync } from 'node:fs';

const out = readFileSync(process.argv[2], 'utf8');
const lines = out.split('\n');

const expected = globSync('test/**/*.test.ts').length;
const fileMarkers = lines.filter((l) => /^\s*[✓❯↓]\s+\S+\.test\.ts \(/.test(l)).length;
const failed = lines.some(
  (l) => /^\s*×\s/.test(l) || /^\s*❯\s+\S+\.test\.ts \(.*\bfailed\b/.test(l) || /^\s*FAIL\s/.test(l),
);

console.log(`[check-tests] test files on disk=${expected}, file results seen=${fileMarkers}, failed=${failed}`);

if (failed) {
  console.error('[check-tests] FAIL — one or more tests failed');
  process.exit(1);
}
if (expected === 0 || fileMarkers < expected) {
  console.error(`[check-tests] FAIL — run incomplete (${fileMarkers}/${expected} files reported before exit)`);
  process.exit(1);
}
console.log('[check-tests] PASS — all test files green');
process.exit(0);
