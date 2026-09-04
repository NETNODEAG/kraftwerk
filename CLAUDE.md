# kraftwerk

## Publishing to npm

`@netnodeag/kraftwerk` is published via GitHub Actions (`.github/workflows/publish.yml`) — never `npm publish` locally.

1. Bump the version in `kraftwerk/package.json` and commit (e.g. `Release 0.15.0: ...`).
2. Push to `main`.
3. Create a GitHub release with tag `vX.Y.Z` (e.g. `gh release create v0.15.0 --target main --title "v0.15.0" --notes "..."`) — publishing the release triggers the workflow.
4. The workflow runs typecheck, publishes with provenance, and verifies the version is visible on the registry.

Re-running with an already-published version fails (npm rejects duplicates). Manual trigger is also possible via workflow_dispatch in the Actions tab.

## Tests

Run from `kraftwerk/`:

- `npm test` — API and CLI tests (`test/**/*.test.ts`, node:test via tsx). `test/api/` starts the real inspector on a free port against a temp project from `test/helpers/project.ts`; `test/cli/` runs the real bin in a fresh process via `test/helpers/cli.ts`. `HOME` is redirected in both so `~/.kraftwerk` stays untouched. Runs in CI before publish.
- `npm run test:e2e` — Playwright (`e2e/*.spec.ts`). `e2e/serve.ts` builds `inspector/dist` if missing and serves a fresh fixture on port 19981. Needs `npx playwright install chromium` once.

Never spawn docker or a coding agent from a test. One fixture per test file: the inspector keeps its project root in module state.
