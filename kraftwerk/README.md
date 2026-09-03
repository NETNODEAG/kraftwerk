# Kraftwerk

**Agentic workspace.** Kraftwerk is an open-source agentic workspace where
humans and persistent AI coworkers work on real tasks together. Agents,
knowledge, skills and workflows belong to the team, not to the person who
happened to set them up, and every result is checked before anyone relies on
it.

```bash
npm install -g @netnodeag/kraftwerk    # or run any command below via npx @netnodeag/kraftwerk

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

Upgrading is the same command with `@latest`. A running inspector serves the
version it started with, so restart each UI afterwards. It offers a relaunch
by itself once a newer version is on disk.

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
kraftwerk knowledge                     # Context & Knowledge: OKF bundles (list/get/put/verify/search/...)
kraftwerk ui                            # inspector web UI on http://localhost:1981; --port, --output
kraftwerk projects                      # every workspace on this machine; projects start|stop|forget <ref>
kraftwerk doctor                        # preflight: harness CLIs, docker, workflows, declared env vars
kraftwerk validate                      # all discovered: schema + semantics + files, exit 1 on failure
kraftwerk validate src/workflows/pitch  # specific paths
kraftwerk create "was der Workflow tun soll"   # for LLM agents: prints a build brief
kraftwerk runner build                  # build the Docker sandbox image (once)
kraftwerk run --sandbox website-check "https://..."   # isolated container per run; --ssh forwards the agent
kraftwerk runner ps / stop <run-id>     # see / stop running sandbox containers
```

### The kraftwerk.yml project config

Optional, at the project root, and also the root marker for the walk-up. All
fields are optional. `workflows:` sets the workflows root, `output:` the
run-artifact directory (default `output/`), `knowledge:` the OKF bundle root
(default `knowledge/`), and `agents:` the team agent-definition root (default
`agents/`).

`switcher:` links other kraftwerk workspaces from the inspector header. The
workspace name becomes a dropdown listing them:

```yaml
switcher:
  - name: other space
    url: https://localhost:1985
    icon: "🛰"   # optional
```

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

## Persistent team agents

The inspector's "team" screen turns chat agents into persistent teammates. A
team member is one folder under the project's `agents/` root:

```
agents/max/
  agent.yml     # name, emoji, description, harness, model, effort, workflows
  system.md     # the member's system prompt (its role)
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
knowledge: [customer-support]   # OKF bundles the member consults & maintains
skills: [report-html]           # optional allowlist; omit = all skills, [] = none
```

Sessions with a member are ordinary chats scoped `{ kind: "team", member }`,
listed per member in a second sidebar. On the first message the member gets
its role plus its connected workflows and knowledge bundles injected as
context. That context includes how to run workflows
(`KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"`) and how to read
and write knowledge through `kraftwerk knowledge`, with writes stamped with
the member's own actor, `<slug>/<harness>`. So the member triggers its own
workflows when a request matches, and keeps its bundles current.

Model and effort ride on backend-specific channels. The claude adapter takes
the model via ACP session options and the thinking budget via
`MAX_THINKING_TOKENS`. Codex gets a `CODEX_CONFIG` env override (`model`,
`model_reasoning_effort`). Pi gets `--model` and `--thinking` flags. Members
are created and edited in the UI, or by editing the files, since the
definition is read fresh for each new session.

### Skills in chat

Chats, both general ones and team sessions, can use skills. These are
Claude-style instruction packages, one folder per skill with a `SKILL.md`
holding YAML frontmatter (`name`, `description`) and then the instructions.
Four roots are discovered, each shadowing same-named skills in the roots below
it:

```
<project>/agents/<slug>/skills/<name>/SKILL.md   # private to that one team agent
<project>/<skills root>/<name>/SKILL.md          # workspace, git-tracked (kraftwerk.yml `skills`, default skills/)
<project>/.claude/skills/<name>/SKILL.md         # git-tracked, per project
~/.claude/skills/<name>/SKILL.md                 # personal, per user
```

Agent skills are visible only to that agent's sessions and always apply. A
member's `skills:` allowlist narrows the shared roots only. Manage them in the
agent profile under "own skills", or by editing the files.

Every chat lists its visible skills as context under "## Your skills", so the
agent reaches for one when the request matches. Typing `/` in the composer
opens an autocomplete over them. Sending `/<name> <args>` expands the skill's
SKILL.md into the prompt, which is what makes this work identically on claude,
codex, and pi. On top of that, claude discovers `.claude/skills` natively (a
team member's `skills:` allowlist narrows that via ACP session options) and pi
loads each visible skill folder via `--skill`. Team members take an optional
`skills:` list in `agent.yml`. Omitted means all discovered skills, an empty
list means none, otherwise it is the allowlist. `GET /api/skills` returns
what's discovered.

### Routines, or scheduled prompts

A member can have routines, cron-scheduled prompts that work like standing
orders for an employee. Definitions live next to the member in
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
cron to set up. Every due routine opens a fresh session for the member, posts
the prompt, and shows up in the sessions sidebar titled "⏰ <name>". Routine
sessions run unattended, so tool-permission requests are auto-approved, with
the request and approval pair left in the thread as an audit trail. Give
routine prompts the same trust you would give a `KRAFTWERK_YES=1` workflow
run. Manage routines on the member page, where you can create, edit and
delete them, toggle enabled, hit "run now", and jump to the last run's
session. Schedules missed while the server is down are skipped, not replayed.

## Context & Knowledge

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

The inspector's Context & Knowledge screen shows bundles, concepts with
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
[`../agent-playground/src/workflows/tagline/`](../agent-playground/src/workflows/tagline/)
and [`../agent-playground/src/workflows/pitch/`](../agent-playground/src/workflows/pitch/);
`check` and `if` in [`../agent-playground/src/workflows/helpdesk-check/`](../agent-playground/src/workflows/helpdesk-check/).
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
[`../agent-playground/src/workflows/rechner/`](../agent-playground/src/workflows/rechner/).

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
