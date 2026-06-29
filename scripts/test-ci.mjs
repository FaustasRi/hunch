// CI test runner. Runs the vitest suite programmatically, reads the result from
// vitest's own state, then force-exits.
//
// Why: on the GitHub-hosted Linux runner, `vitest run` completes the entire suite
// but never exits — worker/esbuild teardown hangs (it exits fine locally on macOS).
// `--outputFile` doesn't help because vitest writes it during that hanging phase.
// Running in-process lets us grab the results the moment the run resolves and
// `process.exit()` deterministically. Honest: any failed test -> exit 1.
import { startVitest } from 'vitest/node';

const vitest = await startVitest('test', [], { watch: false });
if (!vitest) {
  console.error('[test:ci] vitest failed to start');
  process.exit(1);
}

const files = vitest.state.getFiles();
const failedFiles = files.filter((f) => f.result?.state === 'fail');
const passed = files.length - failedFiles.length;
console.log(`[test:ci] ${files.length} test files — ${passed} passed, ${failedFiles.length} failed`);
for (const f of failedFiles) console.error(`[test:ci] FAILED: ${f.name}`);

// vitest's graceful close hangs on this runner; we already have the verdict.
process.exit(failedFiles.length > 0 ? 1 : 0);
