# nn-agent-framework

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

```jsonc
// package.json of your workflow project
"dependencies": { "nn-agent-framework": "file:../nn-agent-framework" }
```

Zero-code consumer (YAML workflows only): that dependency plus workflow
folders under `src/workflows/` is everything — the **kraftwerk** CLI
discovers and runs them, no entry file. Programmatic consumer (TS
workflows, custom gates, approval loops):

```ts
import { defineAgent, Run, runCli, fileNonEmpty, envelopeContract } from "nn-agent-framework";
```

## CLI — kraftwerk

Ships with the package (`npx kraftwerk …` in any consumer, `npm link` for a
global command). Workflows are auto-discovered under `src/workflows/` (or
`workflows/`): every folder with a `workflow.yml` and every top-level
`.yml` file.

```bash
kraftwerk list                          # table: workflows, steps, agents (with harness/model)
kraftwerk run tagline "https://..."     # run; --yes, --verbose
kraftwerk run                           # interactive: pick workflow, type the request
kraftwerk validate                      # all discovered — schema + semantics + files, exit 1 on failure
kraftwerk validate src/workflows/pitch  # specific paths
```

`run` prompts for whatever is missing (workflow picker, request input);
invalid workflows show up red in `list` with their validation error
instead of breaking the listing.

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
# yaml-language-server: $schema=../../../node_modules/nn-agent-framework/schema/workflow.schema.json
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
v1 is deliberately linear — approval loops, code steps, AGENTS.md-style
context files and skills stay on the roadmap; anything non-linear is a TS
workflow.

## Demo

```bash
npm install
npm run demo -- demo "Nebel ueber dem Rhein"
```

[examples/demo/](examples/demo) is the minimal complete workflow: a code
phase, an agent phase judged by gates, a second agent phase that curates in
the **same session**, and the summary table. Artifacts land in
`output/run-<stamp>/`.

## Used by

- [`../agent-playground/`](../agent-playground/) — the in-repo consumer with
  the YAML example workflows (`tagline`, `pitch`).
- `nn-content-workflow-2` (in the local `langgraph/` experiments folder,
  outside this repo) — the netnode.ch content board and Matomo report
  generator; the full ADW pattern including the engineer approval gate and
  revision loop.

To scaffold a new workflow, use the repo-root skill `/new-workflow`.
