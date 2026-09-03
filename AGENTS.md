# kraftwerk — agent notes

## "ship"

When asked to **ship** (or "ship to npm", "release"), do the full cycle without asking:

1. Bump the version in `kraftwerk/package.json` (minor for features, patch for fixes).
2. Commit as `Release X.Y.Z: <summary>` — only the files belonging to the change, leave unrelated working-tree edits (e.g. `agent-playground/`) untouched.
3. Push to `main`.
4. Create the GitHub release: `gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes "..."` — this triggers `.github/workflows/publish.yml`. Never `npm publish` locally.
5. Wait for the workflow to finish: `gh run watch <id> --exit-status`.
6. Install the published version globally: `npm i -g @netnodeag/kraftwerk@X.Y.Z`, then confirm with `kraftwerk --version`.

Running `kraftwerk ui` instances use the global install, so step 6 is what makes the change visible on localhost.
