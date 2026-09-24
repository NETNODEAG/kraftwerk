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

The same goes for a workflow contract a playground demo relies on (a file the runner waits for, a step gated with `if:`, an answer the inspector writes): the demo itself cannot be tested (it runs an agent), so the mechanism gets a test with an equivalent script-only workflow driven through the real bin — `test/api/decision-loop.test.ts` is the pattern. A demo dry-run by hand does not count as a test.

## "check tests"

When asked to **check tests** (or "find test gaps", "what is untested"), do not just run the suite. Go through the code and compare it against what the tests cover:

1. List every public surface: `/api/` routes in `src/inspector/server.ts`, commands in `src/cli/*.ts`, keys in `src/config.ts`, screens in `inspector/src/`.
2. For each, find the test that exercises it. Grep `test/` and `e2e/` for the route path, command name, or config key.
3. Report the gaps ranked by risk: writes before reads, security guards before formatting, code paths with error handling before happy paths.
4. Fill the gaps, most important first, then run `npm test` and `npm run test:e2e`. A gap you decide not to fill gets named in the report with the reason.

## Naming

The persistent chat personas are **agents** — in code, routes, CSS, prose and prompts. Not "team", "team member" or "member": `Agent`, `listAgents`, `/api/agents`, chat scope `{ kind: "agent", slug }`, `agents/<slug>/`. "Team" is reserved for the humans using a workspace.

Git clones the agents work on are **repositories** in prose and the UI, `repos` in code, config, routes and the CLI (`ReposConfig`, `listRepos`, `/api/repos`, `kraftwerk repos`, `repos.root`). Not "projects" — that word is the goal-scoped folders under `kraftwerk-data/projects` (see below). The one persisted legacy is chat `meta.json` written before 0.36 with `{ kind: "team", member }`; `store.ts` upgrades it on read, so never write that shape again.

Shared conversations of several agents are **channels** — `channels/<slug>/channel.yml`, `Channel`, `/api/channels`, chat scope `{ kind: "channel", slug }`. The agents in a channel are its **members** (agent slugs); each member holds a **seat** in the chat (`Seat` in `sessions.ts`: one process per member). The one agent of an ordinary chat is the `MAIN` seat. Events in a channel carry `from` (an `Author`: human by name, agent by slug); events in ordinary chats do not.

The workspace's general chat is **Ralv** — the chief of staff and concierge of the workspace: knows everything in it, advises, and helps launch projects, agents, workflows and knowledge. That is the name in the rail and the roster (`rail.tsx`, `agents.tsx`) and the persona of the `kraftwerk` chat scope's system prompt (`sessions.ts`); the scope names (`general`, `kraftwerk`) and routes (`#/agents/chats`) stay as they are. Not "Chat" or "General Chats" in anything a user sees.

Goal-scoped folders with a brief, systems of record and links are **projects** — `projects/<slug>/project.yml` under `projects.root`, `Project*` types in `src/inspector/projects.ts`, `/api/projects`, chat scope `{ kind: "project", slug }`, `kraftwerk projects`. The registry of kraftwerk roots on this machine is **workspaces** — `~/.kraftwerk/workspaces`, `WorkspaceRecord`, `listWorkspaceRecords`, `/api/workspaces`, `kraftwerk workspaces` (it was `projects` until 0.48; `instances.ts` migrates the old directory once). Inside a project's `project.yml` the outside places are **systems of record** (`records:`, `SystemOfRecord`) and the slug lists are **links** (`LINK_KINDS`); a system of record is context, never a credential or a grant. The `Project` type in `src/config.ts` (the resolved kraftwerk.yml of a workspace) predates both and keeps its name.

Small apps built live in a chat are **vibeables** — one folder each under `vibeables.root`, part of the workspace (synced by the workspace git, never a repository of their own). In code, config, routes and the CLI the word is `vibeables` (`VibeablesConfig`, `listVibeables`, `/api/vibeables`, `/vibeables/<slug>/` for the served files, `kraftwerk vibeables`); the singular `vibeable` names one app (`ChatMeta.vibeable`, `/api/chats/:id/vibeable`, `vibeable.yml` inside the folder). Not "repos" — a vibeable is the workspace's own work, a repository is someone else's history.

## The cloud manager is a sibling repo

The kraftwerk cloud (the `~/.kraftwerk` registry over the internet: instances register and heartbeat, admins see who is active, users see their own) lives in `../kraftwerk-cloud`, its own repo with its own tests. In this repo the feature is the `cloud:` block (`CloudConfig`, `cloudFor(project)` in `src/config.ts`) and the client in `src/inspector/cloud.ts`, which registers after listen, heartbeats on a timer, says goodbye from the exit handlers and reports its state as `cloud` in `/api/meta`. The wire contract (register / heartbeat / goodbye bodies, the identity file under `~/.kraftwerk/cloud/`) is pinned by `test/api/cloud.test.ts` here against a fake cloud and by `test/api.test.ts` there against the real server; a change to the shape is a change to both.

## Optional features are flags in kraftwerk.yml

`git`, `repos`, `vibeables` and `projects` are opt-in blocks: absent = off, a bare key = on with defaults, `enabled: false` keeps the block but turns it off. A new optional feature follows the same shape and plumbing — `<name>RootFor(project)` in `src/config.ts` as the one reader of the block, validation next to the other blocks, a `<name>: boolean` in `/api/meta`, a toggle on the settings screen (`settings.ts` writes the block through the yaml Document API), and the UI hides every entry point while the flag is off (`useFeatures()` in `inspector/src/shared.tsx`).

## The harness is the security layer, not a kraftwerk allowlist

Agents run on claude, codex or pi, and those harnesses decide which tool calls need a human. Kraftwerk never overrides that judgment in either direction: it does not auto-approve a permission request (a routine that runs unattended waits for a human and declines on timeout, `src/inspector/chat/permissions.ts`), and it does not keep its own hand-written list of tools an agent may or may not use. Capability stays with the agent; the only kraftwerk-side choice is ruling out the harness presets that never ask (`unattendedMode` in `permissions.ts`: no claude `bypassPermissions`, no codex full access for routines) — the user's configured mode otherwise stands. "Allow always" answers are stored by the harness, so the allowed set grows from the user's real decisions. A proposed fix that would strip tools from an agent or answer on the user's behalf is the wrong shape for this repo.

## Things that happen while nobody watches go to the bell

Anything a user should notice later — a session waiting for a permission answer, a routine that finished or failed, a workflow run that ended — is one `pushNotification()` call in `src/inspector/notifications.ts`; the UI (bell, tab-title count, browser notification) is generic and reads `/api/notifications`. A live state (a pending permission) carries a `key` and is removed again with `dismissKey()` when it resolves, so the list never shows a question that was already answered. New outbound channels (push, webhook, desktop) hook into this module, not into the event sources.

## Every live state has a way out

Anything the UI shows as running (a run, a session, a routine) must be able to end without a trace event: the process that would write the event may never have started. A run folder that never got a trace ages by its newest file (`src/inspector/runs.ts`), the UI trigger records the launcher's exit code in `trigger.json` (`src/inspector/runner.ts`), and stop/remove work for local runs, not only sandboxed ones. Reason: a workflow that failed at launch (missing env var) sat as "running" with no button that did anything.

## Design tokens in the inspector

`kraftwerk/inspector/src/globals.css` speaks Material 3 role names (`--surface-container-*`, `--primary`, `--secondary-container`, `--outline-variant`, …) but binds them, in the block at the end of the file, to the calm palette of the simplified frontend: a warm paper ground (`--bg`), white panels (`--surface-1`) with hairlines (`--line`) instead of tonal tiers, one violet `--accent` for what starts something (primary buttons, play, active tabs, the headings you navigate by), and colour otherwise only for outcomes (`--ok`, `--bad`, `--ask`, `--live`). Rules: the accent is the workspace colour — `wsPalette()` in `shared.tsx` derives the `--wsp-*` roles from kraftwerk.yml `color` (else the root-derived hue) and app.tsx sets them under `[data-ws-accent]`, which re-binds `--accent`, `--primary` and `--secondary-container` for both schemes; the violet in the end block is only the fallback before the project is known; the interface is set in the system sans (`--font-sans`, nothing bundled) and what an agent says in the reading serif (`--reading`, `.msg.agent`) — two voices, two typefaces; radii are `--radius` 14 and `--radius-s` 9, buttons are pills, icon buttons round; cards use `--card`/`--card-border` (white + hairline) and never a shadow (`--elev-1` is none; `--elev-2/3` only under menus); `--outline` is a border colour, never a text colour; status is a `.status-word` chip; every top-nav destination gets `.active` from the route (`GlobalNav`). When a screen looks off, re-bind a role in that end block rather than hard-coding a colour in the screen.

## The inspector is one page: conversations in columns, everything else a page

The shell (`inspector/src/app.tsx`) has two states on one hash. A conversation route (`agents`, `team`, `chats`, `projects`, `channels` — `CHAT_ROUTES` in `shared.tsx`) shows three columns: the rail (`rail.tsx`, who can be talked to), the conversation, and its context (`context-panel.tsx`: what that agent, project or channel is linked to — workflows with their last run, knowledge, vibeables, repositories, agents, systems of record; the general chat shows the whole workspace). Home (`#/`) is today's dashboard in the middle column with the rail beside it (the rail's first row). Every other route is a page of the workspace under the top bar (`GlobalNav` in `workspace-tabs.tsx`: workflows, knowledge, vibeables, skills, repositories, git, workspaces, settings — expert mode only; simple mode has no top navigation, the rail and the context column are the whole way around). Chat and context are one framed panel divided by a line, and the context's name is a sign on the panel's top edge (`.ctx-head`, positioned over the whole panel, big); the columns wait hidden with their state (`kw-chat-path` in sessionStorage) and come back with the next conversation link. A context row opens the thing inside the column — the page's own component (`BundleView`, `WorkflowView`, `VibePane`) wrapped in a `LocalNav` provider (`shared.tsx`): `Link` hands hrefs under that category's prefix to the provider, so the hash stays and the column re-renders at the new path; hrefs it declines (a run's page) still go to the hash. Never fork a screen for the column — embed it and give it the provider. The column's last category is a browser (`context-browser.tsx`), one per context — its tabs are that conversation's reading (`sessionStorage` under `kw-browser-tabs:<context>`), kept mounted across categories and remounted when the conversation changes; `browse(url)` (the `kw-browse` event) opens a url there, and the tab that already shows that exact url comes to the front instead of a second one. Rendered markdown in the chat gets a small icon after every external link (`withBrowseIcons` + `onBrowseClick` by delegation) that opens it there. Sites that refuse embedding just show blank; the bar's window button is the way out. A screen that redirects on landing must call `navigate(to, { replace: true })`: a redirect into the conversation columns while a page is up moves only the remembered conversation path (the `kw-column-path` event); never write `location.hash` or `location.replace` from a screen. Expert mode adds pages and detail inside the same components — one UI with two depths, not two frontends (the exploratory `inspector-next/` frontend that this shell took its layout and look from was removed in 0.55.0; its ideas live here).

## A knowledge page is its editor

`ConceptView` in `inspector/src/knowledge.tsx` shows a page as a rich-text document (`DocEditor` in `editor.tsx`, MDXEditor, lazy-loaded) and saves as you type — ~1s after the last change, once more when the page is left — keeping the frontmatter untouched; the server re-stamps provenance. There is no read-only view and no `#/edit` route any more (removed 2026-09-24 with the full-screen editor). "edit markdown" is the way to the whole file as text, frontmatter included, with an explicit save. An agent's write to the file restarts the editor only while nothing local is unsaved (`lastRawRef` / `latestRef`), so nobody's typing is clobbered. Reason: Lukas wants to open a page and write, not click into an edit mode.

## Learn from feedback

When the user corrects how something was done, or confirms an approach worth keeping — a convention, a preference about tests or output, a workflow step that was missing — and it would apply to future work on this repo, write it into this file in the matching section (or a new one) as part of the same turn. Keep it to the rule and the reason; no session narrative. Do not record one-off instructions that only apply to the task at hand.

## Paths are stored absolute

Any path a user hands the tool — a project root in a request body, a `kraftwerk workspaces <ref>`, `--output` — goes through `absolutePath()` in `src/config.ts` before it is stored, compared or printed in an error. It expands a leading `~` and resolves the rest; the registry under `~/.kraftwerk` never holds `~/…` or `<cwd>/~/…`. Shells expand the tilde, JSON bodies and quoted arguments do not, so `path.resolve` alone is not enough. Tilde forms are display-only (`tildify`, `rootLabel`).
