# Kraftwerk

**Agentic workspace.** Kraftwerk is an open-source agentic workspace where
humans and persistent AI coworkers work on real tasks together. Agents,
knowledge, skills and workflows belong to the team, not to the person who
happened to set them up, and every result is checked before anyone relies on
it.

```bash
npm install -g @netnodeag/kraftwerk

cd your-project
kraftwerk init                         # scaffold the workspace
kraftwerk doctor                       # check harnesses, docker, workflows, env vars
kraftwerk ui                           # open it at http://localhost:1981
```

Needs Node 20+ and at least one agent harness (Claude Code, Codex, or Pi).
Details in [Install](#install).

**Why teams need it.** AI work today lives in individual silos. Personal
prompts, Claude Code sessions, one-off scripts. What one person figures out
stays with that person. Kraftwerk gives a team one place where that work
becomes shared practice.

- **Shared Agentic Workspace.** Prompts, sessions and scripts turn into
  workflows, skills and knowledge that everyone can see, use and improve.
- **Persistent AI Coworkers.** Agents have a name, a role, a memory and
  standing orders. They keep the knowledge they work with current, and every
  conversation continues where the last one ended.
- **Combine agentic workflows with deterministic workflows.** Every agent step
  has to pass a check that reads the actual files before the work moves on.
  Each run leaves a trace of what happened, how long it took and what it cost.
- **RSI (Recursive Self-Improvement).** By default, all system components are
  built around self-improving.

**What's in the workspace.**

- **Agents.** Persistent AI coworkers, each with its own identity, memory
  and standing orders, running on Claude Code, Codex, Pi, and others.
- **Knowledge.** Shared organisational and project context, browsed like a
  wiki, edited with autosave, verified by humans, exportable as PDF.
- **Skills.** Reusable capabilities and ways of working.
- **Workflows.** Repeatable multi-step processes.
- **Verification.** Gates that check the work against the files on disk.
- **Inspector.** The web UI that brings it all together.

This README is the reference for the framework and CLI. For the overview,
start at the [project README](https://github.com/NETNODEAG/kraftwerk#readme).

## Under the hood

Deterministic workflow-as-code over headless agent harnesses, in the spirit of
[super-simple-software-factory](https://github.com/disler/super-simple-software-factory).
Code owns the control flow, agents work inside bounded phases. "Agent
proposes, code disposes."

Nothing binds to an SDK. Every agent phase spawns one short-lived CLI process
on the agent's harness, then judges the result afterwards against a typed JSON
envelope and file gates. Failed checks are corrected in the same session,
never by a cold restart. Every run leaves a `trace.jsonl` event log and ends
with a time, token and cost summary table.

## Install

You need Node 20 or newer and at least one agent harness on your PATH: Claude
Code (`claude`), Codex (`codex`), or Pi (`pi`). See [Harnesses](#harnesses)
for how to get them. `kraftwerk doctor` checks for all of it and names
whatever is missing.

Install it globally to get the `kraftwerk` command in every project:

```bash
npm install -g @netnodeag/kraftwerk
kraftwerk --version
```

Without installing, every command works prefixed with `npx`, at the cost of a
download per call:

```bash
npx @netnodeag/kraftwerk --version
```

Upgrading is the same command with `@latest`, or "check for updates" in the
inspector's info popover: a newer version gets an "update now" that runs the
install through the server (`POST /api/update`, output in the popover,
`GET /api/update` for its state) with the npm that belongs to the Node the
inspector runs on. It is refused inside a container (rebuild the image) and
when the global folder is not writable by the inspector's user (a system
Node that needs sudo) — then the command is shown to run by hand. A running
inspector serves the version it started with and offers a relaunch once a
newer version is on disk, right after "update now" or after a manual install.

```bash
npm install -g @netnodeag/kraftwerk@latest
kraftwerk projects                 # every workspace on this machine, running or not
```

## Consume

Any repo with workflow folders under `workflows/` (or `src/workflows/`) is
already a complete consumer. No package.json, no local dependency, YAML
workflows only:

```bash
cd your-project
kraftwerk init                     # scaffold kraftwerk.yml + kraftwerk-data/ (workflow, agent, knowledge)
kraftwerk doctor                   # preflight: harness CLIs, docker, workflows, declared env vars
kraftwerk run hello "Was ist kraftwerk?"
kraftwerk ui                       # inspector on http://localhost:1981
```

The same without a global install:

```bash
npx @netnodeag/kraftwerk init
npx @netnodeag/kraftwerk run hello "Was ist kraftwerk?"
npx @netnodeag/kraftwerk ui
```

Your own workflows are just more folders under `workflows/`, each a
`workflow.yml` plus prompt files, discovered automatically (see
[YAML workflows](#yaml-workflows)). Or let a coding agent build one.
`npx @netnodeag/kraftwerk create "<what it should do>"` prints a
self-contained brief that Claude Code or Codex follows end to end.

For a local checkout or a programmatic consumer with TS workflows, custom
gates and approval loops, add the dependency. The `kraftwerk` alias keeps
imports short:

```jsonc
// package.json of your workflow project
"dependencies": { "kraftwerk": "file:../kraftwerk" }   // or: "npm:@netnodeag/kraftwerk"
```

```ts
import { defineAgent, Run, runCli, fileNonEmpty, envelopeContract } from "kraftwerk";
```

## The kraftwerk CLI

The CLI ships with the package. Use `kraftwerk …` after a global install, or
`npx @netnodeag/kraftwerk …` anywhere without one. `npm link` in a dev
checkout also gives you the bare command. Workflows are auto-discovered under
`src/workflows/` (or `workflows/`), meaning every folder with a `workflow.yml`
and every top-level `.yml` file. Every command works from any subdirectory,
because the CLI walks up to the project root, marked by `kraftwerk.yml`, a
workflows root, or `.git`.

```bash
kraftwerk init                          # make this repo a consumer: kraftwerk.yml, workflows/, example
kraftwerk list                          # table: workflows, steps, agents (with harness/model); --json
kraftwerk run tagline "https://..."     # run; --yes, --verbose
kraftwerk run                           # interactive: pick workflow, type the request
kraftwerk runs                          # past runs from output/*/trace.jsonl; runs show <id> for detail
kraftwerk knowledge                     # Knowledge: OKF bundles (list/get/put/verify/search/...)
kraftwerk ui                            # inspector web UI on http://localhost:1981; --port, --output
kraftwerk projects                      # every workspace on this machine; projects start|stop|forget <ref>
kraftwerk doctor                        # preflight: harness CLIs, docker, workflows, declared env vars
kraftwerk validate                      # all discovered: schema + semantics + files, exit 1 on failure
kraftwerk validate src/workflows/pitch  # specific paths
kraftwerk create "was der Workflow tun soll"   # for LLM agents: prints a build brief
kraftwerk runner build                  # build the Docker sandbox image (once)
kraftwerk run --sandbox website-check "https://..."   # isolated container per run; --ssh forwards the agent
kraftwerk runner ps / stop <run-id>     # see / stop running sandbox containers
kraftwerk tunnel setup kw.example.com   # Cloudflare Tunnel to the inspector: login, create, route dns, kraftwerk.yml
kraftwerk tunnel                        # run that tunnel alone (the UI runs elsewhere)
```

The inspector binds `127.0.0.1` — it has no authentication of its own and
its chat runs coding agents against the repo, so it stays off the LAN, and
while bound there it only answers requests whose `Host` is a loopback name
(so a page on another site cannot reach it by re-pointing its own DNS at
127.0.0.1). Inside a container it binds all interfaces instead, because the
port mapping is the boundary there (`deploy-starter/` publishes to
localhost, and its traefik override adds basic-auth). `KRAFTWERK_UI_HOST`
overrides the default either way. A reverse proxy in front of it must set
`X-Forwarded-Host` to the host the browser addressed (Caddy and traefik do
by default; nginx needs `proxy_set_header X-Forwarded-Host $host;`): the
loopback bind answers a non-loopback `Host` only when that header is
present or the name is the project's `public:` hostname, and state-changing
requests are refused when `Origin` names a different host. See
[Inspector through a Cloudflare Tunnel](#inspector-through-a-cloudflare-tunnel).

### The kraftwerk.yml project config

Optional, at the project root, and also the root marker for the walk-up. All
fields are optional. `workflows:` sets the workflows root, `output:` the
run-artifact directory (default `output/`), `knowledge:` the OKF bundle root
(default `knowledge/`), and `agents:` the agent-definition root (default
`agents/`). `repos:` turns on the [repositories](#repositories) folder.
`public:` and `tunnel:` expose the inspector through a
[Cloudflare Tunnel](#inspector-through-a-cloudflare-tunnel).

`switcher:` links other kraftwerk workspaces from the inspector header. The
workspace name becomes a dropdown listing them:

```yaml
switcher:
  - name: other space
    url: https://localhost:1985
    icon: "🛰"   # optional
```

**⌘K** (Ctrl K) anywhere in the inspector opens the palette: type a few
letters of an agent's or channel's name, description or workspace and hit
enter to jump to it. It lists the active agents and the channels of every
workspace on this machine, grouped by workspace and running or not (a
stopped one is started on the way), read from the project registry under
`~/.kraftwerk/projects`, which every inspector keeps current with its
roster and channel list.

### Triggering from CI, cron, or webhooks

`run --json` is the machine mode. It runs non-interactively, prints one JSON
result object on stdout (`ok`, `runDir`, per-phase stats, totals), and sends
all narration to stderr. `KRAFTWERK_YES=1` equals `--yes`, and `--quiet`
silences narration. Exit codes: 0 ok, 2 usage or config error (unknown
workflow, missing env), 3 run failed (gate, blocked, harness), 1 unexpected.

```bash
KRAFTWERK_YES=1 npx @netnodeag/kraftwerk run tagline "https://..." --json > result.json
```

Workflows declare the env vars they need via top-level `requires:
[MATOMO_TOKEN, ...]`. The engine checks them before anything spawns, and both
`kraftwerk list` and `kraftwerk doctor` list them.

### Remote workflows with --from

`list` and `run` accept `--from github:org/repo[@ref]`, or any git URL. The
repo is shallow-cloned to `~/.cache/kraftwerk/remotes/`, refreshed per call
and cached for offline use, and its workflows run locally. Artifacts land in
YOUR `output/`, never in the cache. That way one workflow library serves many
projects without vendoring:

```bash
npx @netnodeag/kraftwerk run --from github:NETNODEAG/workflows tagline "https://..."
```

Sandbox mode (`--sandbox`) runs the workflow in a `kraftwerk-runner`
container, built from `runner/Dockerfile`. The workflow folder mounts
read-only. The run directory bind-mounts straight into the host `output/`, so
trace and artifacts appear live with no copy-back. Env vars come from
`<project>/runner.env`, plus `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`
pass-through. `--run-id` pins the run folder name for external triggers, which
is what the inspector uses. `runner.json` in the run dir records container,
exit code, and timing.

### Runs in the inspector

The runs screen shows every folder under `output/runs/`, live ones with
their phase timeline, finished ones opening on their artifacts. A run's
status comes from `trace.jsonl` first: a `run_summary` settles it, a failed
or blocked phase fails it, and a trace nobody has written to for fifteen
minutes counts as aborted. Two markers settle it earlier: `runner.json`
(sandbox container exit code) and `trigger.json`, which the inspector
writes when a launcher it started exits. A folder that never got a trace at
all — the launcher died first, typically over a missing env var, and only
`trigger.log` tells why — ages by its newest file and shows as failed
instead of running forever; its workflow name is read from the run id.

Every live run has a stop button (`POST /api/runs/:id/stop`): it ends the
detached launcher process group for a local run this inspector started, or
`docker stop`s the `kw-<run-id>` container for a sandboxed one, and answers
404 when neither exists (a run started from the CLI in another terminal).
Every finished run has a remove button (`DELETE /api/runs/:id`) that deletes
the folder; a run that still looks live is refused with 409 — stop it first.

`run` prompts for whatever is missing, both the workflow picker and the
request input. Invalid workflows show up red in `list` with their validation
error instead of breaking the listing. `create` is meant to be run BY an LLM
agent such as Claude Code or Codex. It prints a self-contained brief covering
the schema example, gates, harness rules and verify ladder, which the agent
follows to author the workflow folder and validate and smoke it with this CLI.

### Inspector on a server

The repo root ships [`deploy-starter/`](../deploy-starter/). Copy it into your
consumer repo as `deploy/` and it builds a small image, this package from npm
plus the claude, codex and pi CLIs, that serves `kraftwerk ui` for that repo
bind-mounted at `/work`. `compose.yml` is localhost-only, reachable over an
SSH tunnel. `compose.traefik.yml` layers traefik routing and mandatory
basic-auth on top. Treat that auth as load-bearing. The UI has no
authentication of its own and its chat runs coding agents against the mounted
repo. Agent logins made inside the container persist in the `agent-home`
volume. This is a different image from the `kraftwerk-runner` sandbox
(`runner/Dockerfile`) used by `run --sandbox`.

### Inspector through a Cloudflare Tunnel

The other way to reach a laptop's or server's inspector from elsewhere: no
open port, no reverse proxy, no certificate. `kraftwerk ui` runs
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
next to the inspector and the loopback bind becomes reachable at a hostname
on a domain you have on Cloudflare.

You need a Cloudflare account with a domain added to it (the free plan is
enough), and cloudflared on the machine:

```bash
brew install cloudflared          # macOS; Linux packages: developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

**1. Create the tunnel and route a hostname to it.** From the project root:

```bash
kraftwerk tunnel setup kw.example.com
```

This opens the browser for `cloudflared tunnel login` when there is no
certificate yet (pick the zone `kw.example.com` belongs to), creates a
tunnel named `kraftwerk-<project name>` (or `--name`), adds the CNAME from
the hostname to it, and writes the result into kraftwerk.yml:

```yaml
public: https://kw.example.com   # the hostname the tunnel routes to
tunnel:
  name: kraftwerk-agent-playground
```

A second run reuses the login and the tunnel. If the hostname already has a
DNS record, setup says so and `--overwrite-dns` replaces it. If cloudflared
quietly routed `kw.example.com.other-zone.com` instead, because the hostname
is outside the zone you logged in to, setup refuses and names the stray
record to delete before you log in to the right zone and run it again.

**2. Put a Cloudflare Access policy on the hostname.** The UI has no login
of its own and its chat runs coding agents against the workspace, so the
tunnel must never be the only thing between the internet and it. In the
[Zero Trust dashboard](https://one.dash.cloudflare.com/) go to Access →
Applications → Add an application → Self-hosted, enter `kw.example.com` as
the domain, and add a policy: emails ending in your domain with a one-time
PIN, a Google or GitHub login, whatever fits. Access is free for up to 50
users. From then on Cloudflare shows a login page before anything reaches
the tunnel.

**3. Let the inspector verify that login.** On the application's overview
page copy the Application Audience (AUD) tag, and take your team name from
the team domain `https://<team>.cloudflareaccess.com`:

```yaml
tunnel:
  name: kraftwerk-agent-playground
  access:
    team: my-team
    aud: 4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2
```

With this block the inspector checks the `Cf-Access-Jwt-Assertion` token
Access adds to every request, against the team's public keys, the audience
tag and the clock. A removed or misconfigured policy then fails closed with
a 401 instead of exposing the UI. Skipping the block works, and
`kraftwerk doctor` warns about it every time.

**4. Start.** `kraftwerk ui` now starts cloudflared with the inspector,
keeps it across UI restarts and stops it with the UI:

```
✔ Kraftwerk UI: http://localhost:1981
✔ Public URL: https://kw.example.com
↗ tunnel: running kraftwerk-agent-playground → https://kw.example.com → http://127.0.0.1:1981
  cloudflared │ ... Registered tunnel connection ...
```

Open `https://kw.example.com` from anywhere, log in through Access, and you
are in the same inspector. `localhost:1981` on the machine itself keeps
working without a login. `kraftwerk doctor` reports the tunnel, the Access
block and whether cloudflared is installed.

**Variants.** `kraftwerk tunnel` runs the configured tunnel alone, for an
inspector that already runs elsewhere (started by `kraftwerk projects
start`, or in a container). For a tunnel created in the Zero Trust
dashboard instead (Networks → Tunnels), leave `name` out, route the
hostname to `http://localhost:<port>` there and export its token as
`TUNNEL_TOKEN` before `kraftwerk ui`. `public:` on its own, without
`tunnel:`, is for any other proxy that forwards the browser's `Host`
without setting `X-Forwarded-Host`.

**Troubleshooting.** cloudflared's lines appear prefixed with
`cloudflared │`. "Cannot determine default origin certificate path" means no
login on this machine: run `cloudflared tunnel login` or setup again. "tunnel
not found" means the name in kraftwerk.yml does not exist in the account
that logged in; `cloudflared tunnel list` shows what does. A tunnel that
dies three times right after launch is given up and the UI stays local
until the next start. A 421 "unexpected Host header" in the browser means
`public:` does not match the hostname you opened. A 401 means Access is
configured in kraftwerk.yml but the token is missing or wrong: the
hostname has no Access application, or `team`/`aud` do not match it.

Quick tunnels (`trycloudflare.com`) are deliberately not supported: Access
cannot be attached to them, which would leave the UI open to anyone with
the URL.

## Persistent agents

The inspector's "agents" screen turns chat agents into persistent teammates. An
agent is one folder under the project's `agents/` root:

```
agents/max/
  agent.yml     # name, emoji, description, harness, model, effort, workflows
  system.md     # the agent's system prompt (its role)
```

```yaml
# agents/max/agent.yml
name: Max
emoji: 🛠️
description: Runs and explains this project's workflows
harness: claude        # claude | codex | pi (which chat backend runs it)
model: sonnet          # optional; harness default when omitted
effort: medium         # optional: low | medium | high | xhigh | max
workflows: [tagline, website-check]
knowledge: [customer-support]   # OKF bundles the agent consults & maintains
skills: [report-html]           # optional allowlist; omit = all skills, [] = none
```

Sessions with an agent are ordinary chats scoped `{ kind: "agent", slug }`,
listed per agent in a second sidebar. On the first message the agent gets
its role plus its connected workflows and knowledge bundles injected as
context. That context includes how to run workflows
(`KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"`) and how to read
and write knowledge through `kraftwerk knowledge`, with writes stamped with
the agent's own actor, `<slug>/<harness>`. So the agent triggers its own
workflows when a request matches, and keeps its bundles current.

A chat keeps the agent's own session. The ACP session id is stored with the
chat (`sessions` in `meta.json`), and the next process — after an inspector
restart, or once the idle reaper released the agent — resumes it over
`session/resume`, so the agent continues with its memory rather than with
the transcript as a summary. A session that cannot be resumed (its
transcript is gone) falls back to a fresh one and says so in the thread.
"Fork" branches a chat: a new chat with the same transcript whose agent
continues from a copy of the session (`session/fork`, claude), leaving the
original as it is. Chats over ACP negotiate claude's native subagent and
async task streams: a delegated subagent shows as its own card with its
stream folded underneath, background work (backgrounded shells, monitors)
as task cards that outlive the tool call, and a context compaction as a
"compact" card with the token counts. Session failures the harness reports
(a rate limit, an expired login, a provider outage) arrive structured, not
as prose: a card names the category and the action the harness recommends,
retry, sign in again, or start a fresh session
(`POST /api/chats/:id/reset-session` forgets the stored session id).

The rest of what the adapters announce is in the chat too. The agent's
plan is a checklist card that updates in place. Its questions (Claude's
AskUserQuestion, MCP elicitations) are form cards answered in the thread —
unattended sessions skip an unanswered question after the same deadline as
permissions. A message sent while the agent works is steered into the
running turn instead of waiting (`POST /api/chats/:id/steer`). The header
shows who the agent is signed in as, and in expert mode its context use
and cost plus the model and thinking settings it lets you change live
(`POST /api/chats/:id/config`). The agent's slash commands join the
skills in the `/` menu. Each turn ends with the files the agent says it
changed. Background tasks that can be stopped have a stop button
(`POST /api/chats/:id/task-stop`). Deleting a chat deletes the agent's own
sessions with it, and "continue a session" on the new-chat screen lists
the agent's sessions in the project (`GET /api/agent-sessions`) to pick
one up as a chat.

Files dropped, pasted or attached in the composer go with the message
(`POST /api/chats/:id/attachments`, then `attachments` on the message):
they are stored under the chat's folder, images reach the agent as image
blocks (a screenshot is seen, not described), text files as embedded
resources, everything else by path.

Model and effort ride on backend-specific channels. The claude adapter takes
the model via ACP session options and the thinking budget via
`MAX_THINKING_TOKENS`. Codex gets a `CODEX_CONFIG` env override (`model`,
`model_reasoning_effort`). Pi gets `--model` and `--thinking` flags. Agents
are created and edited in the UI, or by editing the files, since the
definition is read fresh for each new session.

### Repositories

Turn on `repos:` in `kraftwerk.yml` (or the checkbox in settings) and the
workspace gets one folder for the git repositories its agents work on:

```yaml
repos:
  root: kraftwerk-data/repos   # default: repos/ — git-ignored, never synced
```

The folder is the registry. Whatever has a `.git` directly under the root is
a repository, whether the "repositories" screen cloned it, `kraftwerk repos
add <url>` did, or an agent ran `git clone` there. Every entry is read live
from git: origin, branch, head, uncommitted changes, ahead/behind. The
screen clones by url, fetches and fast-forwards clean clones, and removes
them (refusing while they hold unpushed or uncommitted work). Cloning uses
your own git credentials and never prompts, so a private remote has to work
from a terminal first.

Every agent, and the inspector assistant, gets the list as context: where
the root is, what is cloned, and how to add more with the CLI. So "look at
the widgets repo" works as soon as it is cloned, and "clone
github:org/widgets and look at it" works before.

```bash
kraftwerk repos                                  # name, branch, head, state
kraftwerk repos add github:org/widgets           # or any https / ssh url
kraftwerk repos add <url> --name tools --branch dev
kraftwerk repos add <url> --depth 1              # shallow clone of a large repository
kraftwerk repos update widgets                   # fetch, fast-forward when clean
kraftwerk repos remove widgets [--force]
```

`GET /api/repos` returns the same list for automation. The root must be a
folder inside the project (never the project itself): it is excluded from the
workspace git sync, the first clone adds it to `.gitignore`, and `kraftwerk
doctor` warns when git does not ignore it.

### Skills in chat

Chats, both general ones and agent sessions, can use skills. These are
Claude-style instruction packages, one folder per skill with a `SKILL.md`
holding YAML frontmatter (`name`, `description`) and then the instructions.
Four roots are discovered, each shadowing same-named skills in the roots below
it:

```
<project>/agents/<slug>/skills/<name>/SKILL.md   # private to that one agent
<project>/<skills root>/<name>/SKILL.md          # workspace, git-tracked (kraftwerk.yml `skills`, default skills/)
<project>/.claude/skills/<name>/SKILL.md         # git-tracked, per project
~/.claude/skills/<name>/SKILL.md                 # personal, per user
```

Agent skills are visible only to that agent's sessions and always apply. A
agent's `skills:` allowlist narrows the shared roots only. Manage them in the
agent profile under "own skills", or by editing the files.

Every chat lists its visible skills as context under "## Your skills", so the
agent reaches for one when the request matches. Typing `/` in the composer
opens an autocomplete over them. Sending `/<name> <args>` expands the skill's
SKILL.md into the prompt, which is what makes this work identically on claude,
codex, and pi. On top of that, claude discovers `.claude/skills` natively (a
agent's `skills:` allowlist narrows that via ACP session options) and pi
loads each visible skill folder via `--skill`. Agents take an optional
`skills:` list in `agent.yml`. Omitted means all discovered skills, an empty
list means none, otherwise it is the allowlist. `GET /api/skills` returns
what's discovered.

### Routines, or scheduled prompts

An agent can have routines, cron-scheduled prompts that work like standing
orders for an employee. Definitions live next to the agent in
`agents/<slug>/routines.yml` and are git-tracked. Run state (last run, last
session, errors) lives in `<output>/routines-state.json`.

```yaml
# agents/max/routines.yml
- id: morning-check
  name: Morning check
  schedule: "0 9 * * 1-5"   # 5-field cron (server local time) or @hourly/@daily/@weekly/@monthly
  prompt: |
    Run the website-check workflow for https://example.com and summarize
    anything that regressed since the last run.
  enabled: true
```

The inspector server runs the scheduler in-process, so there is no external
cron to set up. Every due routine opens a fresh session for the agent, posts
the prompt, and shows up in the sessions sidebar titled "⏰ <name>". Routine
sessions run unattended in the harness's own permission mode — your
configured claude default (`auto` or `acceptEdits`; plain `default` is lifted
to `acceptEdits`, `bypassPermissions` is never used) or codex's sandboxed
`agent` preset (never full access). Edits inside the project need no
approval, and the harness keeps deciding what still needs a human — shell
commands, network, files outside the project. Kraftwerk never answers those for you.
The question waits in the thread, the routine row and the agent card show
"needs approval", and you allow or deny when you look; "allow always" is
remembered by the harness so the same routine stops asking. A request nobody
answers within 30 minutes is declined and the routine ends with a summary of
what it could not do.

The bell in the top bar collects what happened while you were away: a
session waiting for approval, a routine that finished (with the first lines
of its summary) or failed, a workflow run started from the inspector that
ended. The unread count sits on the bell and in front of the tab title, so a
background tab reads "(2) …"; click an item to jump there. Failure items
carry a "diagnose" button: it opens a chat where the failure is best
understood — the run folder for a failed workflow run, a fresh session of the
same agent for a routine that died mid-run, the kraftwerk-aware chat for a
routine that could not start — and sends a first message that names the
failure, points at the evidence (trace, logs, the failed session's events)
and asks for root cause, fix and how to re-run. Allow browser
notifications once (the bell offers it) and each new item also shows as a
system notification while any inspector tab is open. Items live in
`output/notifications.json`; `GET /api/notifications` lists them,
`POST /api/notifications/read` marks them, `DELETE /api/notifications` clears.

Manage routines on the agent page, where you can create, edit and
delete them, toggle enabled, hit "run now", and jump to the last run's
session. Schedules missed while the server is down are skipped, not replayed.

## Channels

A channel is one conversation shared by several agents and humans — a Slack
channel where the coworkers are agents. The definition is git-tracked with
the workspace, the transcript is a chat like any other:

```
channels/<slug>/channel.yml     # name, purpose, members, responder, maxHops
output/chats/<chat-id>/         # the transcript (scope { kind: channel })
```

```yaml
name: Website relaunch
purpose: ship the new site by March
members: [researcher, writer, dev-ops]   # agent slugs
responder: researcher                    # answers when nobody is @mentioned (optional)
maxHops: 3                               # agent-to-agent handovers per human message
```

Every member agent has its own seat in the channel: its own process, its
own persona, skills, model and permissions, exactly as in a direct session.
What it receives is not the whole transcript each time but the messages
since its last turn, each prefixed with the author (`[Lukas]:` a human,
`[@writer]:` an agent). Who answers:

- `@mention` an agent and it wakes; several mentions run in parallel and
  their replies stream in as separate posts.
- No mention: the channel's responder answers, or nobody if none is set.
- Agents hand over by mentioning each other; `maxHops` bounds the chain
  per human message so two agents never talk forever.
- Humans are never blocked. An agent that is busy when mentioned again runs
  once more when its turn ends, with everything it missed.
- Permission questions from any agent show as cards in the channel and in
  the bell; anyone present can answer.

Create channels on the channels screen, or from an existing agent session
with **add coworker**: the session becomes the channel's transcript, the
agent keeps its process and memory, and the agents you pick join. Your
messages carry the name set in the composer ("posting as"), stored per
browser. API: `GET/POST /api/channels`, `GET/PUT/DELETE /api/channels/:slug`,
`POST /api/channels/from-chat {chatId, name, members}`; messages go through
the chat endpoint with `from` for the poster's name.

Each member chip in a channel shows what that agent is on: the message
that last addressed it, and while it works, its current step (the tool it
is using, else the start of its reply). Clicking a chip opens the agent's
own session — its stream alone, humans' messages for context, tool
activity always visible — and a stop button interrupts just that agent
(`POST /api/chats/:id/cancel {agent}`); "stop all" in the header
interrupts every agent working in the channel.

## Knowledge

Alongside runs and chats, a project can keep curated knowledge as
[OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundles, the Open Knowledge Format. A bundle is a directory of markdown files
with YAML frontmatter under `knowledge/`, one concept per file. Human-readable,
agent-parseable, diffable in git. The frontmatter describes itself: it carries
provenance (`sources`, `generated`), trust (`verified`), and lifecycle
(`status`, `stale_after`).

```
knowledge/
  customer-support/        # one bundle per subdirectory
    index.md               # derived directory listing (regenerated on every write)
    log.md                 # chronological update history (appended on every write)
    playbooks/refunds.md   # a concept: YAML frontmatter + markdown body
```

The `kraftwerk knowledge` CLI is the enforced write path. `put` stamps
`generated: { by, at }` with the writing actor, appends the bundle log, and
regenerates the derived `index.md`, which is what keeps an agent-maintained
corpus trustable:

```bash
kraftwerk knowledge init customer-support               # new bundle
kraftwerk knowledge put customer-support/playbooks/refunds \
  --file refunds.md --actor helpdesk-agent/claude-sonnet-5
kraftwerk knowledge list customer-support               # concepts + trust tier
kraftwerk knowledge get customer-support/playbooks/refunds   # raw markdown; --json parsed
kraftwerk knowledge search "refund"                     # full-text across bundles
kraftwerk knowledge verify customer-support/playbooks/refunds --by human:user
kraftwerk knowledge validate                            # OKF conformance + warnings
kraftwerk knowledge fsck --fix                          # heal out-of-band edits (reindex)
```

Actors follow the OKF convention: `<producer>/<version>` for agents,
`human:<id>` for people, `process:<id>` for automation. Consumers derive a
trust tier per concept from that:

- No `verified` field means unverified.
- Verified by a non-human actor means machine-confirmed.
- Verified by a `human:` actor means human-reviewed.

The inspector's Knowledge screen shows bundles, concepts with
trust, status and staleness badges, sources, and the bundle log. The verify
button records a `human:user` verification. "Curate in chat" opens a
knowledge-scoped chat whose agent knows the OKF essentials and writes through
the CLI.

Workflows read and write knowledge through the same CLI via a
[CLI grant](#cli-grants). The trust model stays intact because every agent
write is stamped with its actor:

```yaml
clis:
  npx kraftwerk knowledge: "OKF knowledge base. Read: `list`, `get <bundle>/<path>`, `search <text>`. Write: `put <bundle>/<path> --file <tmp.md> --actor triager/gpt-5.6`. Frontmatter needs `type:`; never edit index.md/log.md by hand."
agents:
  triager:
    clis: [npx kraftwerk knowledge]
```

## The agent's four axes

```ts
export const desloper = defineAgent({
  id: "desloper",
  name: "Lektorat",
  harness: "codex",                 // WHERE it runs: claude (default) | codex | pi
  model: "gpt-5.6-sol",             // WHAT thinks, in the harness's naming
  effort: "high",                   // optional: low | medium | high | xhigh | max
  tools: ["Read", "Write", "Edit"], // governance: capability boundary
  persona: `Du bist Lektor:in ...`, // WHO: the system prompt
  clis: {                           // optional: CLI grants, the hint is injected
    git: "Versionierung; nach jedem Schritt committen", // into the persona ONCE
  },
  mcp: {                            // optional: MCP servers (governance, like tools)
    calculator: { command: "node", args: ["/path/to/multiply-server.ts"] },
  },
});
```

The task arrives per phase, so one agent can serve several phases. Phases on
the same harness share one resumed session, where an agent sees the
conversation so far but always speaks with its own persona. Phases on
different harnesses share state through the run files only.

## Building blocks

| Building block | What it does |
| --------- | ------------ |
| `defineAgent` ([src/agent.ts](src/agent.ts)) | persona + model/effort + tools + harness |
| `Run.agentPhase({name, agent, prompt, gates})` ([src/run.ts](src/run.ts)) | spawn, parse envelope, run gates, correct in-session (bounded by `maxGateRetries`) |
| `Run.codePhase(name, fn)` | deterministic step, timed and traced |
| Gates ([src/gates.ts](src/gates.ts)) | post-execution file checks: `fileNonEmpty`, `slotsFilled`, `containsText`, or your own `Gate` |
| Envelope ([src/envelope.ts](src/envelope.ts)) | every phase prompt ends with `envelopeContract(phase)`; `parseEnvelope` enforces it |
| Stats ([src/stats.ts](src/stats.ts)) | per-phase attempts/time/tokens/cost, `run.printSummary()` renders the table |
| `runCli(workflows)` ([src/cli.ts](src/cli.ts)) | registry CLI: `npm start -- <name> [--yes] [--verbose] "<request>"` |
| `trace.jsonl` | every event: phase start/end, tool calls, envelopes, gate results, stats |

## Harnesses

One adapter per runtime ([src/harnesses/](src/harnesses)), all speaking the
same interface ([src/harness.ts](src/harness.ts)):

| | claude (default) | codex | pi |
| --- | --- | --- | --- |
| Process | `claude -p --output-format stream-json` | `codex exec --json` | `pi -p --mode json` |
| Resume | `--resume <id>` | `exec resume <thread-id>` | `--session-id <id>` (create-or-continue) |
| Auth | Claude Code login | ChatGPT login | Claude/ChatGPT OAuth **or** vendor API keys |
| Models | Claude ids | GPT ids | `provider/id`, e.g. `deepseek/deepseek-chat`, `openrouter/...` |
| Hermetic | `--setting-sources ""` | `--ignore-user-config` | `--no-context-files` |
| MCP | `--mcp-config` + `--strict-mcp-config`, allowlist `mcp__<name>` | `-c mcp_servers.*` + `--approve-for-me` (headless approvals) | not supported (own extension system) |
| CLIs | scoped allowlist `Bash(<name>:*)` | sandbox runs them anyway (hint only) | plain `bash` tool (no scoping) |
| Quirks | none | no system-prompt flag (persona prepended to prompt); governance = workspace-write sandbox, not per-tool | `effort` maps 1:1 to `--thinking`; tool names lowercased |

Prerequisites per harness:

- **claude** needs Claude Code installed and logged in.
- **codex** needs `brew install --cask codex` and `codex login`.
- **pi** needs `npm install -g @earendil-works/pi-coding-agent`. Anthropic
  models reuse the Claude subscription OAuth, other vendors need their key in
  the env (check with `pi auth check --provider deepseek`).

### Agent protocol

Phases can also run over the [Agent Client Protocol](https://agentclientprotocol.com)
— the same adapters the inspector's chats use (`claude-agent-acp`,
`codex-acp`), bundled with kraftwerk, so nothing needs to be on the PATH.
Set `protocol: acp` at the top of a workflow (every agent) or on one agent;
`runs-on` still picks the harness (pi has no adapter). The adapter process
stays alive for the whole run, so phases on one harness share a session
like `--resume` does on the CLI. Persona and workspace context travel inside
each phase prompt. On claude the agent's `tools`, CLI grants and MCP servers
become the session's allowlist (settings sources off) and the session is
switched to `acceptEdits`; codex runs in its workspace-write mode. A permission request the harness
still raises is declined — nobody watches a workflow run, and kraftwerk
never answers for a human. A programmatic `Run` ends its adapters with
`disposeAcpSessions(runDir)` (the YAML runner does this itself).

```yaml
name: tagline
protocol: acp          # all agents over ACP; per agent: protocol: cli | acp
agents:
  writer:
    runs-on: claude    # or codex
    model: sonnet
```

## YAML workflows

Linear workflows can be pure config, GitHub-Actions-flavored with `steps`,
`runs-on`, and `${{ request }}` / `${{ agent }}`. The canonical form is a
folder. `workflow.yml` holds agents and steps, long prompts live as files next
to it. Load it with `loadWorkflow(path)` and register it like any other
workflow:

```
src/workflows/tagline/
  workflow.yml            # agents inline + steps
  prompts/
    analysieren.md        # referenced from a step, may use ${{ request }}
    texten.md
```

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/NETNODEAG/kraftwerk/main/kraftwerk/schema/workflow.schema.json
name: tagline
description: "Tagline Generator (YAML)"
workspace: |
  Dateien: brand.md, tagline.md
agents:
  analyst:
    runs-on: claude              # claude (default) | codex | pi
    model: haiku                 # effort: low..max optional
    tools: [Read, Write, Edit, WebFetch]
    persona: |
      Du analysierst Marken ...
steps:
  - name: analysieren
    agent: analyst
    prompt: prompts/analysieren.md   # single-line value = file in the folder
    gates:
      - file_non_empty: brand.md
      - contains: { file: brand.md, text: "## Tonalitaet", label: Tonalitaet }
```

Running it needs no code at all, because `kraftwerk run tagline "..."`
discovers the folder. Programmatic registration works too:

```ts
const tagline = await loadWorkflow(path.join(import.meta.dirname, "workflows/tagline"));
runCli({ [tagline.name]: tagline });
```

Single-line `prompt:`, `persona:` and `workspace:` values are file references
inside the folder. Multiline values stay inline, and a plain single `.yml`
file with everything inline works too. `${{ agent }}` interpolates the step's
agent id, so three jury steps can share one `prompts/assess.md` that writes
`verdict-${{ agent }}.md`, as the pitch workflow does. The engine appends the
envelope contract to every step prompt itself.

Validation runs against
[`schema/workflow.schema.json`](schema/workflow.schema.json), which is strict:
unknown keys are errors, and editors autocomplete via the
`# yaml-language-server: $schema=…` line. Semantic checks cover agent
references, duplicate steps, variables, and referenced files.

```bash
kraftwerk validate                             # all discovered workflows
kraftwerk validate src/workflows/tagline       # specific paths
npm start -- validate <path>                   # runCli consumers (TS registry)
```

Gates come in four forms: `file_non_empty: <file>`, `slots_filled: <file>`,
`contains: {file, text, label?}`, and `check: <script>` (or
`check: {run, label?}`). The last one is a bash validation script executed in
the run directory. Exit 0 passes. Non-zero fails, and everything the script
printed becomes the failure message, verbatim in the correction prompt.
Single-line values reference a file inside the workflow folder, like `run:`.

Steps take an optional `if:`, holding deterministic preconditions in the same
forms as gates, evaluated against the run directory just before the step. Any
unmet precondition skips the step, traced as `phase_skipped` while the run
continues. This is how you avoid spawning an agent when a previous script
found nothing to do:

```yaml
  - name: triage tickets
    agent: triager
    if:
      - file_non_empty: todo.json    # written by the fetch step only when work exists
    prompt: prompts/triage.md
    gates:
      - check: scripts/validate-triage.sh
```

Living examples:
[`../agent-playground/kraftwerk-data/workflows/tagline/`](../agent-playground/kraftwerk-data/workflows/tagline/)
and [`../agent-playground/kraftwerk-data/workflows/pitch/`](../agent-playground/kraftwerk-data/workflows/pitch/);
`check` and `if` in [`../agent-playground/kraftwerk-data/workflows/helpdesk-check/`](../agent-playground/kraftwerk-data/workflows/helpdesk-check/).
v1 is deliberately linear. Approval loops and AGENTS.md-style context files
stay on the roadmap, and skills exist in chat rather than in workflow runs.
Anything non-linear is a TS workflow.

### MCP servers alongside the workflow

A workflow folder can carry its own MCP servers, and agents opt in by name,
the same governance model as `tools`. Relative files resolve inside the
folder. Absolute paths and `url:` entries hook up external or remote servers:

```yaml
mcp:
  calculator:
    command: node                    # node >= 24 runs TypeScript directly
    args: [mcp/multiply-server.ts]   # file inside the workflow folder
  linear:
    url: https://mcp.linear.app/mcp  # remote streamable HTTP
agents:
  rechner:
    model: sonnet
    tools: [Read, Write]
    mcp: [calculator]                # this agent may use these servers
```

The stdio server is any MCP server, for instance `@modelcontextprotocol/sdk`
with `server.tool(...)` and `StdioServerTransport`, its deps declared in the
consumer's `package.json`. On claude the servers are passed hermetically with
`--strict-mcp-config` and the allowlist gains `mcp__<name>`. On codex they
become `-c mcp_servers.*` overrides and the phase runs with `--approve-for-me`
so headless MCP calls get approved. Combining `runs-on: pi` with `mcp` is
rejected at validation time. Living example:
[`../agent-playground/kraftwerk-data/workflows/rechner/`](../agent-playground/kraftwerk-data/workflows/rechner/).

### CLI grants

For command-line tools that already exist, an MCP server is more than the job
needs. Declare them once and grant them per agent, so no step prompt has to
repeat which CLIs exist or how to call them:

```yaml
clis:                      # command prefix -> one-line usage hint
  my: "CLI fuer my.netnode.ch. Immer --json und -w <workspace-id> verwenden."
  git: ""                  # empty hint = name only
agents:
  reporter:
    tools: [Read, Write]
    clis: [my, git]        # this agent may call these via Bash
```

The hint is injected into the agent's persona ONCE. That is the whole point,
since it keeps step prompts clean.

Each harness handles the grant differently. Claude also scopes the Bash
allowlist to `Bash(<name>:*)`, so the granted prefixes run headless without
approval while everything else keeps claude's default judgment, auto-approving
read-only commands and denying mutating ones. Codex needs nothing, because the
workspace-write sandbox runs commands anyway. Pi has no per-command scoping, so
a grant enables the plain `bash` tool.

## Used by

- [`../agent-playground/`](../agent-playground/) is the in-repo consumer with
  the YAML example workflows: `tagline`, `pitch`, `rechner` with its own
  MCP server, and `website-check` with script steps.
- `nn-content-workflow-2` lives in the local `langgraph/` experiments folder
  outside this repo. It generates the netnode.ch content board and Matomo
  report, and shows the full ADW pattern including the engineer approval gate
  and revision loop.

To scaffold a new workflow, use the repo-root skill `/new-workflow`.

## Developer

Source is TypeScript under `src/`. The published package ships compiled
JavaScript and type declarations under `dist/`, built by
`tsc -p tsconfig.build.json`. The bin shim `bin/kraftwerk.js` runs the TS
source via `tsx` whenever `src/` is present, which covers a dev checkout and
`npm link`. Edits are always live, and a stale `dist/` can never shadow them.
Published installs contain no `src/`, so they take the compiled `dist/` path.
`KRAFTWERK_DIST=1 kraftwerk …` forces `dist/` from the checkout, which is
handy for verifying a fresh build.

```bash
npm run typecheck   # tsc --noEmit over src/
npm run validate    # validate the example workflows
npm run build       # clean + compile src/ -> dist/ (JS + .d.ts)
npm link            # global `kraftwerk` command from this checkout (no build needed)
```

### Publishing

`prepublishOnly` runs the build automatically, so publishing is just:

```bash
npm publish         # runs npm run build first via prepublishOnly
```

The `files` field whitelists the tarball: `bin/`, `dist/`, `runner/` (the
Dockerfile for sandboxed runs), `schema/` (the workflow JSON schema), and
`inspector/dist/` (the prebuilt web UI for `kraftwerk ui`, built by
`prepublishOnly` and served by the dependency-free server compiled into
`dist/inspector/`). No `src/`, no examples. Check with `npm pack --dry-run`
before a release. Runtime deps stay regular `dependencies`, while `tsx`,
`typescript`, and the inspector's Vite and React toolchain are dev-only, so
consumers install none of them.
