# kraftwerk

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
npx @netnode/kraftwerk init      # scaffold kraftwerk.yml + workflows/ + example
npx @netnode/kraftwerk run hello "Was ist kraftwerk?"
```

For a local checkout / programmatic consumer (TS workflows, custom gates,
approval loops), add the dependency (the `kraftwerk` alias keeps imports
short):

```jsonc
// package.json of your workflow project
"dependencies": { "kraftwerk": "file:../kraftwerk" }   // or: "npm:@netnode/kraftwerk"
```

```ts
import { defineAgent, Run, runCli, fileNonEmpty, envelopeContract } from "kraftwerk";
```

## CLI — kraftwerk

Ships with the package (`npx @netnode/kraftwerk …` anywhere, `npm link` in
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
fields optional: `workflows:` (workflows root) and `output:` (run-artifact
directory, default `output/`).

### Triggering from CI / cron / webhooks

`run --json` is the machine mode: non-interactive, one JSON result object
on stdout (`ok`, `runDir`, per-phase stats, totals), all narration on
stderr. `KRAFTWERK_YES=1` equals `--yes`, `--quiet` silences narration.
Exit codes: 0 ok, 2 usage/config error (unknown workflow, missing env),
3 run failed (gate/blocked/harness), 1 unexpected.

```bash
KRAFTWERK_YES=1 npx @netnode/kraftwerk run tagline "https://..." --json > result.json
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
npx @netnode/kraftwerk run --from github:NETNODEAG/workflows tagline "https://..."
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
`contains: {file, text, label?}`. Living examples:
[`../agent-playground/src/workflows/tagline/`](../agent-playground/src/workflows/tagline/)
and [`../agent-playground/src/workflows/pitch/`](../agent-playground/src/workflows/pitch/).
v1 is deliberately linear — approval loops, AGENTS.md-style context files
and skills stay on the roadmap; anything non-linear is a TS workflow.

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
(Dockerfile for sandboxed runs), `schema/` (workflow JSON schema) — no
`src/`, examples, or inspector. Check with `npm pack --dry-run` before a
release. Runtime deps stay regular `dependencies`; `tsx` and `typescript`
are dev-only, so consumers install neither.
