# kraftwerk

**Agentic workspace.** Kraftwerk is an open-source agentic workspace where
humans and persistent AI coworkers work on real tasks together.

**Why it exists.** We think every team needs a place to bring persistent AI
coworkers and humans together to get work done. Today, AI work mostly lives in
individual silos: personal prompts, Claude Code sessions, scripts, and one-off
automations. Kraftwerk turns individual AI use into shared, repeatable ways of
working across a team or organisation.

**How it works.** Kraftwerk brings together:

- **Agents** — persistent AI coworkers, each with its own identity and memory,
  running on Claude Code, Codex, Pi, and others
- **Skills** — reusable capabilities and ways of working
- **Knowledge** — shared organisational and project context
- **Workflows** — repeatable multi-step processes
- **Verification** — deterministic gates that check the work

**The shift.** From everyone using AI individually → to the organisation
working agentically. Kraftwerk is the shared place where that work lives,
runs, and improves over time.

## Under the hood

Deterministic workflow-as-code over headless agent harnesses, in the spirit of
[super-simple-software-factory](https://github.com/disler/super-simple-software-factory):
**code owns the control flow, agents work inside bounded phases.**
"Agent proposes, code disposes."

No SDK dependency: every agent phase spawns one short-lived CLI process on the
agent's **harness** and judges the result afterwards (typed JSON envelope +
file gates). Failed checks are corrected in the same session, never by a cold
restart. Every run leaves a `trace.jsonl` event log and ends with a
time/token/cost summary table.

## Consume

Zero-setup consumer (YAML workflows only): a repo containing workflow
folders under `workflows/` (or `src/workflows/`) IS a complete consumer —
no package.json, no install:

```bash
npx @netnodeag/kraftwerk init      # scaffold kraftwerk.yml + workflows/ + example
npx @netnodeag/kraftwerk run hello "Was ist kraftwerk?"
```

Your own workflows are just more folders under `workflows/` — a
`workflow.yml` plus prompt files, discovered automatically (see
[YAML workflows](#yaml-workflows)). Or let a coding agent build one:
`npx @netnodeag/kraftwerk create "<what it should do>"` prints a
self-contained brief that Claude Code / Codex follows end to end.

For a local checkout / programmatic consumer (TS workflows, custom gates,
approval loops), add the dependency (the `kraftwerk` alias keeps imports
short):

```jsonc
// package.json of your workflow project
"dependencies": { "kraftwerk": "file:../kraftwerk" }   // or: "npm:@netnodeag/kraftwerk"
```

```ts
import { defineAgent, Run, runCli, fileNonEmpty, envelopeContract } from "kraftwerk";
```

## CLI — kraftwerk

Ships with the package (`npx @netnodeag/kraftwerk …` anywhere, `npm link` in
the checkout for a global `kraftwerk`). Workflows are auto-discovered under
`src/workflows/` (or `workflows/`): every folder with a `workflow.yml` and
every top-level `.yml` file. Every command works from any subdirectory —
the CLI walks up to the project root (marked by `kraftwerk.yml`, a
workflows root, or `.git`).

```bash
kraftwerk init                          # make this repo a consumer: kraftwerk.yml, workflows/, example
kraftwerk list                          # table: workflows, steps, agents (with harness/model); --json
kraftwerk run tagline "https://..."     # run; --yes, --verbose
kraftwerk run                           # interactive: pick workflow, type the request
kraftwerk runs                          # past runs from output/*/trace.jsonl; runs show <id> for detail
kraftwerk knowledge                     # Context & Knowledge: OKF bundles (list/get/put/verify/search/...)
kraftwerk ui                            # inspector web UI on http://localhost:1981; --port, --output
kraftwerk doctor                        # preflight: harness CLIs, docker, workflows, declared env vars
kraftwerk validate                      # all discovered — schema + semantics + files, exit 1 on failure
kraftwerk validate src/workflows/pitch  # specific paths
kraftwerk create "was der Workflow tun soll"   # for LLM agents: prints a build brief
kraftwerk runner build                  # build the Docker sandbox image (once)
kraftwerk run --sandbox website-check "https://..."   # isolated container per run; --ssh forwards the agent
kraftwerk runner ps / stop <run-id>     # see / stop running sandbox containers
```

### Project config — kraftwerk.yml

Optional, at the project root (also the root marker for the walk-up); all
fields optional: `workflows:` (workflows root), `output:` (run-artifact
directory, default `output/`), `knowledge:` (OKF knowledge-bundle root,
default `knowledge/`), and `agents:` (team agent-definition root, default
`agents/`).

`switcher:` links other kraftwerk workspaces from the inspector header —
the workspace name becomes a dropdown listing them:

```yaml
switcher:
  - name: other space
    url: https://localhost:1985
    icon: "🛰"   # optional
```

### Triggering from CI / cron / webhooks

`run --json` is the machine mode: non-interactive, one JSON result object
on stdout (`ok`, `runDir`, per-phase stats, totals), all narration on
stderr. `KRAFTWERK_YES=1` equals `--yes`, `--quiet` silences narration.
Exit codes: 0 ok, 2 usage/config error (unknown workflow, missing env),
3 run failed (gate/blocked/harness), 1 unexpected.

```bash
KRAFTWERK_YES=1 npx @netnodeag/kraftwerk run tagline "https://..." --json > result.json
```

Workflows declare the env vars they need via top-level `requires:
[MATOMO_TOKEN, ...]` — checked before anything spawns, listed by
`kraftwerk list` and `kraftwerk doctor`.

### Remote workflows — --from

`list` and `run` accept `--from github:org/repo[@ref]` (or any git URL):
the repo is shallow-cloned to `~/.cache/kraftwerk/remotes/` (refreshed per
call, cached offline) and its workflows run locally — artifacts land in
YOUR `output/`, not the cache. Share one workflow library across projects
without vendoring:

```bash
npx @netnodeag/kraftwerk run --from github:NETNODEAG/workflows tagline "https://..."
```

Sandbox mode (`--sandbox`) runs the workflow in a `kraftwerk-runner`
container (see `runner/Dockerfile`): workflow folder mounted read-only,
the run directory bind-mounted straight into the host `output/` — trace
and artifacts appear live, no copy-back. Env vars come from
`<project>/runner.env` (plus `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`
pass-through); `--run-id` pins the run folder name for external triggers
(the inspector uses this). `runner.json` in the run dir records
container, exit code, and timing.

`run` prompts for whatever is missing (workflow picker, request input);
invalid workflows show up red in `list` with their validation error
instead of breaking the listing. `create` is meant to be run BY an LLM
agent (Claude Code, Codex): it prints a self-contained brief — schema
example, gates, harness rules, verify ladder — that the agent follows to
author the workflow folder and validate/smoke it with this CLI.

### Inspector on a server — deploy starter

The repo root ships [`deploy-starter/`](../deploy-starter/): copy it
into your consumer repo as `deploy/` and it builds a small image (this
package from npm + the claude/codex/pi CLIs) that serves `kraftwerk ui`
for that repo, bind-mounted at `/work`. `compose.yml` is localhost-only
(SSH tunnel); `compose.traefik.yml` layers traefik routing + mandatory
basic-auth on top — the UI has no authentication of its own and its chat
runs coding agents against the mounted repo. Agent logins made inside
the container persist in the `agent-home` volume. This is a different
image from the `kraftwerk-runner` sandbox (`runner/Dockerfile`) used by
`run --sandbox`.

## Team — persistent agents

The inspector's "team" screen turns chat agents into persistent teammates.
A team member is one folder under the project's `agents/` root:

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
harness: claude        # claude | codex | pi — which chat backend runs it
model: sonnet          # optional; harness default when omitted
effort: medium         # optional: low | medium | high | xhigh | max
workflows: [tagline, website-check]
knowledge: [customer-support]   # OKF bundles the member consults & maintains
skills: [report-html]           # optional allowlist; omit = all skills, [] = none
```

Sessions with a member are ordinary chats scoped `{ kind: "team", member }`,
listed per member in a second sidebar. On the first message the member gets
its role plus its connected workflows and knowledge bundles injected as
context — including how to run workflows
(`KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"`) and how to read
and write knowledge through `kraftwerk knowledge` (writes stamped with the
member's own actor, `<slug>/<harness>`), so it triggers its own workflows
when a request matches and keeps its bundles current. Model/effort ride on
backend-specific channels: the claude adapter takes the model via ACP session
options and the thinking budget via `MAX_THINKING_TOKENS`; codex gets a
`CODEX_CONFIG` env override (`model`, `model_reasoning_effort`); pi gets
`--model`/`--thinking` flags. Members are created and edited in the UI (or by
editing the files — the definition is read fresh for each new session).

### Skills in chat

Chats — general ones and team sessions — can use skills: Claude-style
instruction packages, one folder per skill with a `SKILL.md` (YAML
frontmatter `name` + `description`, then the instructions). Discovered
roots, each shadowing same-named skills in the roots below it:

```
<project>/agents/<slug>/skills/<name>/SKILL.md   # private to that one team agent
<project>/<skills root>/<name>/SKILL.md          # workspace, git-tracked (kraftwerk.yml `skills`, default skills/)
<project>/.claude/skills/<name>/SKILL.md         # git-tracked, per project
~/.claude/skills/<name>/SKILL.md                 # personal, per user
```

Agent skills are visible only to that agent's sessions and always apply —
a member's `skills:` allowlist narrows the shared roots only. They're
managed in the agent profile ("own skills") or by editing the files.

Every chat lists its visible skills as context ("## Your skills"), so the
agent reaches for one when the request matches. Typing `/` in the composer
opens an autocomplete over them; sending `/<name> <args>` expands the
skill's SKILL.md into the prompt — which is why this works identically on
claude, codex, and pi. Natively on top of that, claude discovers
`.claude/skills` itself (a team member's `skills:` allowlist narrows that
via ACP session options) and pi loads each visible skill folder via
`--skill`. Team members take an optional `skills:` list in `agent.yml`:
omitted means all discovered skills, an empty list means none, otherwise
it's the allowlist. `GET /api/skills` returns what's discovered.

### Routines — scheduled prompts

A member can have routines: cron-scheduled prompts, like standing orders for
an employee. Definitions live next to the member in
`agents/<slug>/routines.yml` (git-tracked); run state (last run, last
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

The inspector server runs the scheduler in-process (no external cron): every
due routine opens a fresh session for the member, posts the prompt, and the
run shows up in the sessions sidebar titled "⏰ <name>". Routine sessions run
unattended, so tool-permission requests are auto-approved (the
request/approval pair stays in the thread as an audit trail) — treat routine
prompts with the same trust as `KRAFTWERK_YES=1` workflow runs. Manage
routines on the member page: create/edit/delete, toggle enabled, "run now",
and jump to the last run's session. Missed schedules while the server is
down are skipped, not replayed.

## Context & Knowledge — OKF bundles

Alongside runs and chats, a project can keep curated knowledge as
[OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundles (Open Knowledge Format): directories of markdown files with YAML
frontmatter under `knowledge/`, one concept per file. Human-readable,
agent-parseable, diffable in git — and self-describing: frontmatter
carries provenance (`sources`, `generated`), trust (`verified`), and
lifecycle (`status`, `stale_after`).

```
knowledge/
  customer-support/        # one bundle per subdirectory
    index.md               # derived directory listing (regenerated on every write)
    log.md                 # chronological update history (appended on every write)
    playbooks/refunds.md   # a concept: YAML frontmatter + markdown body
```

The `kraftwerk knowledge` CLI is the enforced write path — `put` stamps
`generated: { by, at }` with the writing actor, appends the bundle log,
and regenerates the derived `index.md`, so an agent-maintained corpus
stays trustable:

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
`human:<id>` for people, `process:<id>` for automation. Consumers derive
a **trust tier** per concept: no `verified` ⇒ unverified, verified by
non-human actors ⇒ machine-confirmed, verified by a `human:` actor ⇒
human-reviewed. The inspector's **Context & Knowledge** screen shows
bundles, concepts with trust/status/staleness badges, sources, and the
bundle log — the ✓ verify button records a `human:user` verification, and
"curate in chat" opens a knowledge-scoped chat whose agent knows the OKF
essentials and writes through the CLI.

Workflows read and write knowledge through the same CLI via a
[CLI grant](#cli-grants) — the trust model stays intact because every
agent write is stamped with its actor:

```yaml
clis:
  npx kraftwerk knowledge: "OKF knowledge base. Read: `list`, `get <bundle>/<path>`, `search <text>`. Write: `put <bundle>/<path> --file <tmp.md> --actor triager/gpt-5.6`. Frontmatter needs `type:`; never edit index.md/log.md by hand."
agents:
  triager:
    clis: [npx kraftwerk knowledge]
```

## The agent — four axes

```ts
export const desloper = defineAgent({
  id: "desloper",
  name: "Lektorat",
  harness: "codex",                 // WHERE it runs: claude (default) | codex | pi
  model: "gpt-5.6-sol",             // WHAT thinks, in the harness's naming
  effort: "high",                   // optional: low | medium | high | xhigh | max
  tools: ["Read", "Write", "Edit"], // governance: capability boundary
  persona: `Du bist Lektor:in ...`, // WHO: the system prompt
  clis: {                           // optional: CLI grants — the hint is injected
    git: "Versionierung; nach jedem Schritt committen", // into the persona ONCE
  },
  mcp: {                            // optional: MCP servers (governance, like tools)
    calculator: { command: "node", args: ["/path/to/multiply-server.ts"] },
  },
});
```

The task arrives per phase, so one agent can serve several phases. Phases on
the same harness share one resumed session (an agent sees the conversation so
far but always speaks with its own persona); phases on different harnesses
share state through the run files only.

## Primitives

| Primitive | What it does |
| --------- | ------------ |
| `defineAgent` ([src/agent.ts](src/agent.ts)) | persona + model/effort + tools + harness |
| `Run.agentPhase({name, agent, prompt, gates})` ([src/run.ts](src/run.ts)) | spawn → parse envelope → run gates → correct in-session (bounded by `maxGateRetries`) |
| `Run.codePhase(name, fn)` | deterministic step, timed and traced |
| Gates ([src/gates.ts](src/gates.ts)) | post-execution file checks: `fileNonEmpty`, `slotsFilled`, `containsText` — or your own `Gate` |
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
| Quirks | — | no system-prompt flag (persona prepended to prompt); governance = workspace-write sandbox, not per-tool | `effort` maps 1:1 to `--thinking`; tool names lowercased |

Prerequisites: **claude** — Claude Code installed + logged in. **codex** —
`brew install --cask codex` + `codex login`. **pi** — `npm install -g
@earendil-works/pi-coding-agent`; Anthropic models reuse the Claude
subscription OAuth, other vendors need their key in the env (check with
`pi auth check --provider deepseek`).

## YAML workflows

Linear workflows can be pure config — GitHub-Actions-flavored (`steps`,
`runs-on`, `${{ request }}` / `${{ agent }}`). The canonical form is a
**folder**: `workflow.yml` holds agents + steps, long prompts live as files
next to it. Loaded with `loadWorkflow(path)` and registered like any other
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

Running it needs no code at all — `kraftwerk run tagline "..."` discovers
the folder. Programmatic registration works too:

```ts
const tagline = await loadWorkflow(path.join(import.meta.dirname, "workflows/tagline"));
runCli({ [tagline.name]: tagline });
```

Single-line `prompt:`/`persona:`/`workspace:` values are file references
inside the folder; multiline values stay inline (a plain single `.yml` file
with everything inline works too). `${{ agent }}` interpolates the step's
agent id — three jury steps can share one `prompts/assess.md` that writes
`verdict-${{ agent }}.md` (see the pitch workflow). The engine appends the
envelope contract to every step prompt itself.

**Validation**: [`schema/workflow.schema.json`](schema/workflow.schema.json)
(strict — unknown keys are errors, editors autocomplete via the
`# yaml-language-server: $schema=…` line) plus semantic checks (agent
references, duplicate steps, variables, referenced files):

```bash
kraftwerk validate                             # all discovered workflows
kraftwerk validate src/workflows/tagline       # specific paths
npm start -- validate <path>                   # runCli consumers (TS registry)
```

Gates: `file_non_empty: <file>`, `slots_filled: <file>`,
`contains: {file, text, label?}`, and `check: <script>` (or
`check: {run, label?}`) — a bash validation script executed in the run
directory; exit 0 passes, non-zero fails and everything the script printed
becomes the failure message, verbatim in the correction prompt. Single-line
values reference a file inside the workflow folder, like `run:`.

Steps take an optional `if:` — deterministic preconditions in the same
forms as gates, evaluated against the run directory just before the step.
Any unmet precondition SKIPS the step (traced as `phase_skipped`, run
continues) — the way to avoid spawning an agent when a previous script
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
`check`/`if` in [`../agent-playground/src/workflows/helpdesk-check/`](../agent-playground/src/workflows/helpdesk-check/).
v1 is deliberately linear — approval loops and AGENTS.md-style context files
stay on the roadmap (skills exist in chat, not in workflow runs); anything
non-linear is a TS workflow.

### MCP servers alongside the workflow

A workflow folder can carry its own MCP servers; agents opt in by name
(governance, like `tools`). Relative files resolve inside the folder,
absolute paths and `url:` entries hook up external/remote servers:

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

The stdio server is any MCP server (e.g. `@modelcontextprotocol/sdk` +
`server.tool(...)` + `StdioServerTransport`, its deps in the consumer's
`package.json`). On claude the servers are passed hermetically
(`--strict-mcp-config`) and the allowlist gains `mcp__<name>`; on codex
they become `-c mcp_servers.*` overrides and the phase runs with
`--approve-for-me` so headless MCP calls get approved; `runs-on: pi` +
`mcp` is rejected at validation time. Living example:
[`../agent-playground/src/workflows/rechner/`](../agent-playground/src/workflows/rechner/).

### CLI grants

For existing command-line tools an MCP server is overkill — declare them
once and grant per agent, so no step prompt has to repeat which CLIs
exist or how to call them:

```yaml
clis:                      # command prefix -> one-line usage hint
  my: "CLI fuer my.netnode.ch. Immer --json und -w <workspace-id> verwenden."
  git: ""                  # empty hint = name only
agents:
  reporter:
    tools: [Read, Write]
    clis: [my, git]        # this agent may call these via Bash
```

The hint is injected into the agent's persona ONCE (that's the point —
step prompts stay clean). Per harness: **claude** additionally scopes the
Bash allowlist to `Bash(<name>:*)` — the granted prefixes run headless
without approval, everything else keeps claude's default judgment
(read-only commands auto-approve, mutating ones are denied). **codex**
needs nothing (the workspace-write sandbox runs commands anyway).
**pi** has no per-command scoping — a grant enables the plain `bash`
tool.

## Used by

- [`../agent-playground/`](../agent-playground/) — the in-repo consumer with
  the YAML example workflows (`tagline`, `pitch`, `rechner` with its own
  MCP server, `website-check` with script steps).
- `nn-content-workflow-2` (in the local `langgraph/` experiments folder,
  outside this repo) — the netnode.ch content board and Matomo report
  generator; the full ADW pattern including the engineer approval gate and
  revision loop.

To scaffold a new workflow, use the repo-root skill `/new-workflow`.

## Developer

Source is TypeScript under `src/`; the published package ships compiled
JavaScript + type declarations under `dist/` (built by `tsc -p
tsconfig.build.json`). The bin shim `bin/kraftwerk.js` runs the TS source
via `tsx` whenever `src/` is present (dev checkout, `npm link`) — edits
are always live, a stale `dist/` can never shadow them. Published
installs contain no `src/`, so they take the compiled `dist/` path.
`KRAFTWERK_DIST=1 kraftwerk …` forces `dist/` from the checkout, e.g. to
verify a fresh build.

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

The tarball is whitelisted via `files`: `bin/`, `dist/`, `runner/`
(Dockerfile for sandboxed runs), `schema/` (workflow JSON schema), and
`inspector/dist/` (the prebuilt web UI for `kraftwerk ui` — built by
`prepublishOnly`, served by the dependency-free server compiled into
`dist/inspector/`) — no `src/` or examples. Check with `npm pack
--dry-run` before a release. Runtime deps stay regular `dependencies`;
`tsx`, `typescript`, and the inspector's Vite/React toolchain are
dev-only, so consumers install none of them.
