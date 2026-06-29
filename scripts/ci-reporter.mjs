// CI-only vitest reporter that force-exits the process the moment the run finishes.
//
// Why: on the GitHub-hosted Linux runner, vitest completes the whole suite but its
// teardown never exits (worker/esbuild handles linger), so `vitest run`, the JSON
// --outputFile, and even programmatic startVitest() all hang — anything that waits
// for vitest to *finish exiting* stalls until the job timeout. `onFinished` runs
// inside vitest's lifecycle the instant results are aggregated, BEFORE teardown, so
// exiting here gives us the verdict and skips the hang. It exits fine locally too.
//
// Honest: any failed test (or top-level error) -> exit 1.
export default class CiForceExitReporter {
  onFinished(files = [], errors = []) {
    const failedFiles = files.filter((f) => f.result?.state === 'fail');
    const failed = failedFiles.length > 0 || (errors?.length ?? 0) > 0;
    const passed = files.length - failedFiles.length;
    console.log(
      `[ci-reporter] ${files.length} test files — ${passed} passed, ${failedFiles.length} failed` +
        (errors?.length ? `, ${errors.length} top-level error(s)` : ''),
    );
    for (const f of failedFiles) console.error(`[ci-reporter] FAILED: ${f.name}`);
    process.exit(failed ? 1 : 0);
  }
}
