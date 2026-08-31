# kraftwerk

## Publishing to npm

`@netnodeag/kraftwerk` is published via GitHub Actions (`.github/workflows/publish.yml`) — never `npm publish` locally.

1. Bump the version in `kraftwerk/package.json` and commit (e.g. `Release 0.15.0: ...`).
2. Push to `main`.
3. Create a GitHub release with tag `vX.Y.Z` (e.g. `gh release create v0.15.0 --target main --title "v0.15.0" --notes "..."`) — publishing the release triggers the workflow.
4. The workflow runs typecheck, publishes with provenance, and verifies the version is visible on the registry.

Re-running with an already-published version fails (npm rejects duplicates). Manual trigger is also possible via workflow_dispatch in the Actions tab.
