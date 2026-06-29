# RELEASING — CD to npm

Hunch ships to npm so anyone can `npx -y hunch-mcp`. Releases are **tag-driven** and deliberate — the build loop never publishes.

## One-time setup

1. Create an npm **automation** access token (npmjs.com → Access Tokens → Granular/Automation, publish scope for `hunch-mcp`).
2. Add it as a GitHub repo secret named **`NPM_TOKEN`** (`gh secret set NPM_TOKEN`).
3. First publish of an unscoped public name may need to be done once locally (`npm publish --access public`) to claim `hunch-mcp`; thereafter CI handles it.

## Cutting a release

```bash
# on a green main
npm version patch        # or minor / major — bumps package.json + creates a commit + tag
git push --follow-tags   # pushes the commit and the v* tag
```

Pushing the `v*` tag triggers `.github/workflows/release.yml`, which runs `npm ci`, `npm run verify`, then `npm publish --provenance --access public`. `prepublishOnly` re-runs `verify` as a final guard, so a broken build cannot ship.

## Notes

- **Provenance** is enabled (`--provenance` + `id-token: write`) — the package gets a verifiable build attestation on npm. Public repo + public package required, which is the case.
- Version `0.0.0` is the pre-release scaffold; the first real release is `0.1.0` once the v1 checkpoints (M0–M8) are done and `EXIT_SIGNAL` has fired.
- CD publishes **only** on tags; ordinary loop commits to `main` run CI but never publish.
