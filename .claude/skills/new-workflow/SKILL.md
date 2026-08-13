---
name: new-workflow
description: Scaffold a new nn-agent-framework workflow (agents, prompts, gates, steps, CLI registration) or a fresh consumer project. Use when the user wants to create or extend a workflow built on nn-agent-framework.
---

# Scaffold an nn-agent-framework workflow

You are building a workflow on **nn-agent-framework** (the `nn-agent-framework/` package in this repo): deterministic TypeScript owns the control flow, agents work inside bounded phases on headless CLI harnesses. "Agent proposes, code disposes."

Shortcut for YAML workflows: `kraftwerk create "<was der Workflow tun soll>"` prints a self-contained build brief (schema example, gates, harness rules, verify ladder) — follow it. The sections below add the repo-specific references and the TS-workflow path.

## 1 — Read the living references first

Templates live in code, not in this skill — read them before writing anything:

- `nn-agent-framework/README.md` — primitives, harness table, YAML folder schema, prerequisites
- `nn-agent-framework/examples/demo/` — minimal complete TS workflow (agents.ts, workflow.ts, main.ts)
- `agent-playground/src/workflows/tagline/` — the YAML workflow-folder reference (workflow.yml + prompts/, GHA-flavored: steps, runs-on, ${{ request }})
- `agent-playground/src/workflows/pitch/` — YAML folder with one prompt file shared by three jury steps via ${{ agent }}
- `nn-agent-framework/src/index.ts` — the exact public API; `schema/workflow.schema.json` — the YAML contract

## 2 — Gather from the user (ask if unclear)

1. Workflow name + one-line description (shows up in the CLI listing).
2. Steps in order — for each: **agent step** (judgment/writing) or **code phase** (deterministic work: fetching, rendering, templating — never an agent; TS only).
3. Agents: persona (WHO), model + optional effort (WHAT thinks), tools (governance), harness (WHERE: `claude` default | `codex` | `pi`).
4. Gates per agent step — what file evidence proves the step worked?
5. Human approval loop needed? (engineer gate + revision cycle — TS only for now)
6. New workflow in an existing consumer (e.g. agent-playground) or a fresh project?
7. **YAML or TS?** Linear sequence of gated agent steps → a workflow FOLDER (`<name>/workflow.yml` + `prompts/*.md`, loaded with `loadWorkflow`; envelope handled by the engine). Loops, code phases, approval gates, custom gates → TS workflow.

## 3 — Scaffold

**YAML workflow folder** `src/workflows/<name>/`:
- `workflow.yml` — `# yaml-language-server: $schema=…` header, `agents:` inline (model, tools, persona, optional `runs-on`/`effort`), `steps:` with gates
- `prompts/*.md` — one file per long prompt, referenced as `prompt: prompts/<step>.md`; variables `${{ request }}`, `${{ agent }}`
- NO registration needed: the kraftwerk CLI auto-discovers workflow folders under `src/workflows/`. (Programmatic alternative: `loadWorkflow(...)` + `runCli({...})`.)

**TS workflow folder** `src/workflows/<name>/`:
- `agents.ts` (`defineAgent`), `stages.ts` (workspaceContext + prompts, each ending with `envelopeContract(phase)`), optional `gates.ts` (custom `Gate`s), `workflow.ts` (`WorkflowDefinition`; mkdir the runDir BEFORE the first phase; end with `run.printSummary()`)

**Fresh consumer project**: YAML-only consumers need just `package.json` with `"type": "module"`, `"start": "kraftwerk"`, and `"dependencies": { "nn-agent-framework": "file:../nn-agent-framework" }` (see agent-playground) — no tsconfig, no devDeps, no entry file. TS consumers additionally: `"start": "tsx src/index.ts"`, devDeps typescript/tsx/@types/node, tsconfig with NodeNext + `"types": ["node"]`.

## 4 — House rules (enforce these)

- Code owns sequencing, retries, and acceptance. Agents never decide phase transitions, retries, or publishing.
- Every agent-step prompt ends with the envelope contract (YAML: automatic; TS: append `envelopeContract(phase)`, phase name MUST equal the step name).
- Gates are post-execution checks on files in the runDir — verify claims, never predictions. Prefer several small gates with precise failure messages (they go verbatim into the correction prompt).
- Sessions are per harness: same-harness steps share conversational context via resume; cross-harness state must live in run files (so the workspace context must describe the file layout).
- Harness guidance: `claude` needs nothing extra. `codex` needs ChatGPT login; no system-prompt flag (the adapter prepends the persona), governance = workspace-write sandbox, a WebFetch/WebSearch grant enables sandbox network access, models from the codex line (e.g. `gpt-5.6-sol`). `pi` uses `provider/id` model names (`anthropic/...` rides the Claude OAuth; `deepseek/...`, `openrouter/...` need the vendor key — `pi auth check --provider <p>`); mixing model families across steps catches different failure modes.
- Expensive models only where judgment matters; `effort` low..max per agent.

## 5 — Verify (in this order)

1. `npm run typecheck` where TypeScript exists (framework, TS consumers) — YAML-only consumers have nothing to typecheck.
2. YAML workflows: `kraftwerk validate` (all discovered) or `kraftwerk validate src/workflows/<name>` — schema + semantic checks without running anything.
3. `kraftwerk list` — free; proves discovery and shows the roster with harness/model per agent.
4. Cheap smoke: `kraftwerk run <name> "..."` with all agents on `model: "haiku"` (or codex, $0 on subscription) before switching to expensive models — check gates pass, the summary table renders, and `output/run-*/trace.jsonl` records the steps.
5. Only then a real run with the production roster.
