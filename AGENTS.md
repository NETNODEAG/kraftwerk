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

Goal-scoped folders with a brief, systems of record and links are **projects** — `projects/<slug>/project.yml` under `projects.root`, `Project*` types in `src/inspector/projects.ts`, `/api/projects`, chat scope `{ kind: "project", slug }`, `kraftwerk projects`. The registry of kraftwerk roots on this machine is **workspaces** — `~/.kraftwerk/workspaces`, `WorkspaceRecord`, `listWorkspaceRecords`, `/api/workspaces`, `kraftwerk workspaces` (it was `projects` until 0.48; `instances.ts` migrates the old directory once). Inside a project's `project.yml` the outside places are **systems of record** (`records:`, `SystemOfRecord`) and the slug lists are **links** (`LINK_KINDS`); a system of record is context, never a credential or a grant. The `Project` type in `src/config.ts` (the resolved kraftwerk.yml of a workspace) predates both and keeps its name.

Small apps built live in a chat are **vibeables** — one folder each under `vibeables.root`, part of the workspace (synced by the workspace git, never a repository of their own). In code, config, routes and the CLI the word is `vibeables` (`VibeablesConfig`, `listVibeables`, `/api/vibeables`, `/vibeables/<slug>/` for the served files, `kraftwerk vibeables`); the singular `vibeable` names one app (`ChatMeta.vibeable`, `/api/chats/:id/vibeable`, `vibeable.yml` inside the folder). Not "repos" — a vibeable is the workspace's own work, a repository is someone else's history.

## Optional features are flags in kraftwerk.yml

`git`, `repos`, `vibeables` and `projects` are opt-in blocks: absent = off, a bare key = on with defaults, `enabled: false` keeps the block but turns it off. A new optional feature follows the same shape and plumbing — `<name>RootFor(project)` in `src/config.ts` as the one reader of the block, validation next to the other blocks, a `<name>: boolean` in `/api/meta`, a toggle on the settings screen (`settings.ts` writes the block through the yaml Document API), and the UI hides every entry point while the flag is off (`useFeatures()` in `inspector/src/shared.tsx`).

## The harness is the security layer, not a kraftwerk allowlist

Agents run on claude, codex or pi, and those harnesses decide which tool calls need a human. Kraftwerk never overrides that judgment in either direction: it does not auto-approve a permission request (a routine that runs unattended waits for a human and declines on timeout, `src/inspector/chat/permissions.ts`), and it does not keep its own hand-written list of tools an agent may or may not use.

The one exception is a *contained* session, and it is one because the question moved rather than disappeared: a customer on a share link talking to a **sandboxed** agent is never asked, because there is nobody on that side who may decide, and because the admin already answered in `sandbox:` — which files exist in the container, which hosts it can reach, which commands it can run, each enforced by the kernel rather than by a prompt. `containedMode()` picks the harness preset that does not ask and `allowOption()` allows anything that still arrives. It is gated on `tuning.sandbox`: an agent on the host gets the ordinary unattended treatment, because there the prompt is the only thing standing between a customer's request and this machine. A change that lets `contained` be set without a sandbox is the wrong shape. Capability stays with the agent; the only kraftwerk-side choice is ruling out the harness presets that never ask (`unattendedMode` in `permissions.ts`: no claude `bypassPermissions`, no codex full access for routines) — the user's configured mode otherwise stands. "Allow always" answers are stored by the harness, so the allowed set grows from the user's real decisions. A proposed fix that would strip tools from an agent or answer on the user's behalf is the wrong shape for this repo.

## The sandbox is the boundary, the harness is still the judge

The rule above holds: kraftwerk keeps no hand-written list of tools an agent
may or may not call. When an agent has to be *contained* — anything exposed
beyond the people who run the workspace — the limit goes on the boundary, not
on the tool list: what exists inside the container at all, whether it has a
network, which secrets are in its environment, how much CPU, memory and how
many pids it gets (`sandbox:` in agent.yml, `src/runner/agent-sandbox.ts`).
Inside that boundary the harness keeps deciding which individual call needs a
human, exactly as before.

The workspace is never bind-mounted into a sandbox. The container gets an
empty volume at `/workspace` and, on top of it, only what the grants already
in agent.yml name (`knowledge:`, `workflows:`, `skills:`). Nothing inside a
sandbox is ever addressed by its host path — an agent behind a share link is
someone else's, and the path alone discloses the admin's username and how the
server is laid out. `sandboxPath()` translates the structured paths (cwd,
mount targets, claude's extra directories) and `redactHostPaths()` rewrites
the finished context string, so a newly added context block cannot leak one
by forgetting to translate.
Mount-everything-then-hide is the wrong shape for the same reason a tool
allowlist is: it defaults to "all" and relies on remembering every exception.
`sandboxStartFor()` in `src/inspector/agents.ts` is the one place that
resolves those grants, because the container is started once and reused —
two callers disagreeing about the mounts would make an agent's reach depend
on who started it first. For the same reason anything that changes what a
sandbox would mount has to stop the container: `saveAgent` when a grant
changed, `saveAgentSandbox` always. A grant edited in the UI that only takes
effect the next time something happens to restart the container reads as a
broken feature, not as a caching subtlety.

The profile is editable over HTTP (`PUT /api/agents/:slug/sandbox`), so
`normalizeSandbox()` validates every field rather than trusting it — each one
ends up in a docker argument. A value that does not fit its shape falls back
to the default, never to the absence of a limit.

The reason the two do not conflict: a tool allowlist is a *deny* list with a
default of "everything", and bash makes it porous (grant `git` and you have
granted every hook it can run). A sandbox profile is a *grant* with a default
of nothing, and it is enforced by the kernel rather than by a prompt. So a
proposed change that strips tools from an agent is still the wrong shape; one
that narrows what the container can reach is the right one.

The two limits that exist are the two that a container can actually hold.
`network: allowlist` puts the agent on a Docker network with no route out and
an egress proxy as its only door, so a refused domain fails because the
packets have nowhere to go. `commands:` takes the "other" bits off every
binary outside the list while the agent runs as a non-root uid, so an
absolute path or a copy does not get around it. Both are enforced by the
kernel; neither asks the agent to cooperate. A limit that cannot be expressed
this way does not belong in `sandbox:` — it belongs to the harness.

The command list covers binaries and nothing else: a shell's builtins are not
files, so `printf`, `echo` and globbing survive any list, and the shell cannot
be removed without removing the adapter. Do not try to close that by
enumerating what the agent may type — that is the porous deny-list shape
again. The answer is the boundary below it (what is mounted, what the network
reaches) plus `sandboxContext()`, which tells the agent its limits up front so
it names them instead of routing around them.

Three properties this must keep. It fails closed — a container that cannot start
ends the turn with the reason, never a quiet fall back to the host, which
would drop the boundary an admin set. The inspector stays the ACP *client* on the
host while only the adapter moves inside, which is what keeps the transcript,
the events and the audit trail out of the agent's own reach. And a container
is not handed to a caller until its policy is fully applied (`waitReady`):
`docker run -d` returns long before an init has finished, and a turn that
landed in the gap would run in a sandbox that is only half closed — worse,
differently so depending on how busy the machine is.

## Things that happen while nobody watches go to the bell

Anything a user should notice later — a session waiting for a permission answer, a routine that finished or failed, a workflow run that ended — is one `pushNotification()` call in `src/inspector/notifications.ts`; the UI (bell, tab-title count, browser notification) is generic and reads `/api/notifications`. A live state (a pending permission) carries a `key` and is removed again with `dismissKey()` when it resolves, so the list never shows a question that was already answered. New outbound channels (push, webhook, desktop) hook into this module, not into the event sources.

## Every live state has a way out

Anything the UI shows as running (a run, a session, a routine) must be able to end without a trace event: the process that would write the event may never have started. A run folder that never got a trace ages by its newest file (`src/inspector/runs.ts`), the UI trigger records the launcher's exit code in `trigger.json` (`src/inspector/runner.ts`), and stop/remove work for local runs, not only sandboxed ones. Reason: a workflow that failed at launch (missing env var) sat as "running" with no button that did anything.

## Design tokens in the inspector

`kraftwerk/inspector/src/globals.css` is a Material 3 token system in the Google-apps idiom: a pure white page in light (Google's dark greys in dark), cool grey tonal containers instead of bordered cards, green and red only for outcomes. Rules that keep it punchy: the accent is the workspace colour — `wsPalette()` in `inspector/src/shared.tsx` derives the primary and secondary-container roles for both schemes from kraftwerk.yml `color` and app.tsx sets them inline on `<html>` under `data-ws-accent`, so buttons, toggles, checkboxes, selected states and focus rings all follow it (the `--primary*` roles in the scheme blocks are only the fallback before the project is known); cards use `--card`, `--card-head`, `--card-border`, `--card-shadow` (tone in dark, shadow in light) and the top bar `--topbar-ground`, never a surface tier plus `--elev-*` directly; a card is a tonal region (`--card` = surface-container-low on white, surface-container in dark) with no border and no shadow, and its head one tier up; `--outline` is a border colour and never a text colour (it fails 4.5:1 in light); the type scale is 28 / 24 / 16 / 14 / 13.5 / 12 / 11.5 and the shape scale 8 / 12 / 16 / 28 / full — do not add sizes or radii between them; status is a `.status-word` chip; every top-nav destination gets `.active` from the route (`navCls` in app.tsx). Reason: the UI read as flat when primary was the text colour, surface tiers sat 1.07:1 apart, and the nav had no selected state.

## Learn from feedback

When the user corrects how something was done, or confirms an approach worth keeping — a convention, a preference about tests or output, a workflow step that was missing — and it would apply to future work on this repo, write it into this file in the matching section (or a new one) as part of the same turn. Keep it to the rule and the reason; no session narrative. Do not record one-off instructions that only apply to the task at hand.

## Paths are stored absolute

Any path a user hands the tool — a project root in a request body, a `kraftwerk workspaces <ref>`, `--output` — goes through `absolutePath()` in `src/config.ts` before it is stored, compared or printed in an error. It expands a leading `~` and resolves the rest; the registry under `~/.kraftwerk` never holds `~/…` or `<cwd>/~/…`. Shells expand the tilde, JSON bodies and quoted arguments do not, so `path.resolve` alone is not enough. Tilde forms are display-only (`tildify`, `rootLabel`).
