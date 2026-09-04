# kraftwerk — agent notes

## "ship"

When asked to **ship** (or "ship to npm", "release"), do the full cycle without asking:

1. Test first, in `kraftwerk/`: `npm run typecheck && npm test && npm run test:e2e && npm run build`. All four must pass (the build is what `prepublishOnly` runs in the publish workflow, and it uses `tsconfig.build.json`, not the typecheck config — a change to either tsconfig can pass the typecheck and still break the publish) before anything is committed; a failing test stops the ship, it is never skipped or deleted to get through. If the change touches a server route, git sync, config loading, or a UI flow, add or extend a test for it (`test/api/` for server behaviour, `e2e/` for browser flows) in the same commit — see the Tests section in `CLAUDE.md` for the layout and fixtures. `e2e/serve.ts` only builds `inspector/dist` when it is missing, so after a UI change run `npm run build:inspector` first or the e2e suite tests the previous build.
2. Bump the version in `kraftwerk/package.json` (minor for features, patch for fixes).
3. Commit as `Release X.Y.Z: <summary>` — only the files belonging to the change, leave unrelated working-tree edits (e.g. `agent-playground/`) untouched.
4. Push to `main`.
5. Create the GitHub release: `gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes "..."` — this triggers `.github/workflows/publish.yml` (which runs typecheck and `npm test` again). Never `npm publish` locally.
6. Wait for the workflow to finish: `gh run watch <id> --exit-status`.
7. Install the published version globally: `npm i -g @netnodeag/kraftwerk@X.Y.Z`, then confirm with `kraftwerk --version`.

Running `kraftwerk ui` instances use the global install, so step 7 is what makes the change visible on localhost.

## Tests come with the feature

Any new feature that exposes an API — an inspector route under `/api/`, a CLI command or flag, a `kraftwerk.yml` key — ships with a test in the same commit. No exceptions for "small" endpoints: the test is what proves the contract. Where it goes:

- `kraftwerk/test/api/` — server routes, through the real server on a free port (`startServer` in `test/helpers/project.ts`).
- `kraftwerk/test/cli/` — commands, through the real bin in a fresh process (`cli()` in `test/helpers/cli.ts`).
- `kraftwerk/e2e/` — a browser flow, only when the feature has a screen.

Assert on behaviour a user sees (exit code, JSON shape, a file on disk, a row in the UI), not on internals. Never spawn docker or a coding agent from a test.

## "check tests"

When asked to **check tests** (or "find test gaps", "what is untested"), do not just run the suite. Go through the code and compare it against what the tests cover:

1. List every public surface: `/api/` routes in `src/inspector/server.ts`, commands in `src/cli/*.ts`, keys in `src/config.ts`, screens in `inspector/src/`.
2. For each, find the test that exercises it. Grep `test/` and `e2e/` for the route path, command name, or config key.
3. Report the gaps ranked by risk: writes before reads, security guards before formatting, code paths with error handling before happy paths.
4. Fill the gaps, most important first, then run `npm test` and `npm run test:e2e`. A gap you decide not to fill gets named in the report with the reason.

## Naming

The persistent chat personas are **agents** — in code, routes, CSS, prose and prompts. Not "team", "team member" or "member": `Agent`, `listAgents`, `/api/agents`, chat scope `{ kind: "agent", slug }`, `agents/<slug>/`. "Team" is reserved for the humans using a workspace.

Git clones the agents work on are **repositories** in prose and the UI, `repos` in code, config, routes and the CLI (`ReposConfig`, `listRepos`, `/api/repos`, `kraftwerk repos`, `repos.root`). Not "projects" — that word is the registry of kraftwerk workspaces (`~/.kraftwerk/projects`). The one persisted legacy is chat `meta.json` written before 0.36 with `{ kind: "team", member }`; `store.ts` upgrades it on read, so never write that shape again.

Small apps built live in a chat are **vibeables** — one folder each under `vibeables.root`, part of the workspace (synced by the workspace git, never a repository of their own). In code, config, routes and the CLI the word is `vibeables` (`VibeablesConfig`, `listVibeables`, `/api/vibeables`, `/vibeables/<slug>/` for the served files, `kraftwerk vibeables`); the singular `vibeable` names one app (`ChatMeta.vibeable`, `/api/chats/:id/vibeable`, `vibeable.yml` inside the folder). Not "repos" — a vibeable is the workspace's own work, a repository is someone else's history.

## Optional features are flags in kraftwerk.yml

`git`, `repos` and `vibeables` are opt-in blocks: absent = off, a bare key = on with defaults, `enabled: false` keeps the block but turns it off. A new optional feature follows the same shape and plumbing — `<name>RootFor(project)` in `src/config.ts` as the one reader of the block, validation next to the other blocks, a `<name>: boolean` in `/api/meta`, a toggle on the settings screen (`settings.ts` writes the block through the yaml Document API), and the UI hides every entry point while the flag is off (`useFeatures()` in `inspector/src/shared.tsx`).

## Learn from feedback

When the user corrects how something was done, or confirms an approach worth keeping — a convention, a preference about tests or output, a workflow step that was missing — and it would apply to future work on this repo, write it into this file in the matching section (or a new one) as part of the same turn. Keep it to the rule and the reason; no session narrative. Do not record one-off instructions that only apply to the task at hand.

## Paths are stored absolute

Any path a user hands the tool — a project root in a request body, a `kraftwerk projects <ref>`, `--output` — goes through `absolutePath()` in `src/config.ts` before it is stored, compared or printed in an error. It expands a leading `~` and resolves the rest; the registry under `~/.kraftwerk` never holds `~/…` or `<cwd>/~/…`. Shells expand the tilde, JSON bodies and quoted arguments do not, so `path.resolve` alone is not enough. Tilde forms are display-only (`tildify`, `rootLabel`).
