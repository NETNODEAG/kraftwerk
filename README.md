<p align="center">
  <img src="assets/logo.svg" alt="kraftwerk" width="640"/>
</p>

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

## Why teams need it

AI work today lives in individual silos. Personal prompts, Claude Code
sessions, one-off scripts. What one person figures out stays with that person,
and the next colleague starts from zero. Kraftwerk gives a team one place
where that work becomes shared practice.

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

## What's in the workspace

**Agents.** Persistent AI coworkers, each with its own identity and memory,
running on Claude Code, Codex, Pi, and others. An agent has a name, an emoji,
a role, a harness and model to run on, and the workflows and knowledge that
belong to its job. Sessions are conversations with that same agent. Routines
are cron-scheduled prompts, like standing orders. Each one opens a session
when it comes due, runs unattended, and lands in the sidebar for review.

```yaml
# agents/max/agent.yml
name: Max
emoji: 🛠️
description: Runs and explains this project's workflows
harness: claude        # claude | codex | pi
model: sonnet
workflows: [tagline, website-check]
knowledge: [customer-support]   # bundles it consults & maintains
```

**Knowledge.** Shared organisational and project context, kept as
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundles. Every page is plain markdown, and its frontmatter records who wrote
it, from what, who confirmed it, and how long it stays current. Agents read
and write these pages in chats and mid-workflow. People browse them like a
wiki, edit in a document editor with autosave, verify with one click, and
export a bundle or a single page as PDF.

**Skills.** Instruction packages a team writes once and every agent can use.
Type `/` in any chat to invoke one. The same skill works on claude, codex and
pi.

**Workflows.** Repeatable multi-step processes. A sequence of agent and script
steps described in YAML, with prompts as markdown files beside it. Run one
from the UI, the CLI, a routine, or CI.

**Verification.** Gates that check the work. A gate reads the files on disk,
asking whether brand.md is non-empty or whether report.html contains
`</html>`, and never trusts what the agent claims. Fail a gate and the agent
fixes it in the same conversation.

**Inspector.** The web UI for all of the above: agents and their sessions,
knowledge, skills, workflows, and live runs with phase timeline, trace and
artifacts. The frontend ships prebuilt and the server uses only Node's
standard library, so there is nothing to install at startup.

```bash
npx @netnodeag/kraftwerk ui        # http://localhost:1981
```

## How it works under the hood

Code owns the control flow. Agents work inside bounded steps. "Agent
proposes, code disposes."

A workflow is a list of steps of two kinds. An agent step spawns one
short-lived CLI process (`claude -p`, `codex exec`, or `pi`), hands it one
task, and reads back a typed JSON envelope with phase, status, artifacts and
summary. Then the step's gates run against the files. Pass every gate and the
run moves on. Fail one and its message goes back to the same agent session for
another try, up to a retry limit. A script step is deterministic code, a bash
script or a TS function, for fetching, rendering, templating, anything that
needs no judgment. Same envelope, same gates, no model.

There is no SDK to bind to, so you can mix models from different vendors in
one workflow and change the model behind a step by editing one line. Steps on
the same harness share one resumed session. Steps on different harnesses share
state only through the run's files. Every run writes a `trace.jsonl` event log
and ends with a table of time, tokens, and cost per step.

## Install

Kraftwerk is on npm as
[`@netnodeag/kraftwerk`](https://www.npmjs.com/package/@netnodeag/kraftwerk).
You need Node 20 or newer, plus at least one agent harness on your PATH
(Claude Code, Codex, or Pi). `kraftwerk doctor` checks all of it.

Install it globally to get the `kraftwerk` command in every project:

```bash
npm install -g @netnodeag/kraftwerk
kraftwerk --version
```

Every command below also works prefixed with `npx @netnodeag/kraftwerk`, at
the cost of a download per call:

```bash
npx @netnodeag/kraftwerk --version
```

## Get started

Any project becomes a workspace with one command. Run `init` in the repo you
want to work in:

```bash
cd your-project
kraftwerk init                        # scaffold kraftwerk.yml + kraftwerk-data/ (workflow, agent, knowledge)
kraftwerk doctor                      # preflight: harness CLIs, docker, workflows, env vars
kraftwerk run hello "What is kraftwerk?"
kraftwerk ui                          # open the workspace at http://localhost:1981
```

The same, without a global install:

```bash
cd your-project
npx @netnodeag/kraftwerk init
npx @netnodeag/kraftwerk run hello "What is kraftwerk?"
npx @netnodeag/kraftwerk ui
```

To upgrade later, install again and restart any running UI. An inspector
serves the version it started with, and offers a relaunch once a newer one is
on disk:

```bash
npm install -g @netnodeag/kraftwerk@latest
kraftwerk projects                    # every workspace on this machine, running or not
```

### Write a workflow

A workflow is a folder under `workflows/`. It holds a `workflow.yml` with
agents and gated steps, plus long prompts as markdown files next to it. The
CLI discovers the folder automatically:

```yaml
# workflows/tagline/workflow.yml
# yaml-language-server: $schema=https://raw.githubusercontent.com/NETNODEAG/kraftwerk/main/kraftwerk/schema/workflow.schema.json
name: tagline
description: "Write a tagline from a website"
workspace: |
  Files: brand.md (analysis), tagline.md (result).
agents:
  analyst:
    model: haiku                       # runs-on: claude (default) | codex | pi
    tools: [Read, Write, WebFetch]
    persona: |
      You analyze brands based on their website.
  writer:
    model: sonnet
    tools: [Read, Write]
    persona: prompts/writer-persona.md # single-line value = file in the folder
steps:
  - name: analyze
    agent: analyst
    prompt: prompts/analyze.md         # prompts may use ${{ request }}
    gates:
      - file_non_empty: brand.md
  - name: write
    agent: writer
    prompt: prompts/write.md
    gates:
      - file_non_empty: tagline.md
```

```bash
npx @netnodeag/kraftwerk validate                # strict schema + semantic checks
npx @netnodeag/kraftwerk run tagline "https://example.com"
npx @netnodeag/kraftwerk runs                    # inspect past runs
npx @netnodeag/kraftwerk projects                # every workspace this machine ran; projects start|stop <name>
```

Prefer not to write it by hand? `npx @netnodeag/kraftwerk create "<what it
should do>"` prints a build brief for a coding agent, which then authors,
validates, and smoke-tests the workflow folder for you. Triggering from CI is
one line (`KRAFTWERK_YES=1 npx @netnodeag/kraftwerk run <name> "..." --json`),
and a shared workflow library in its own repo runs anywhere via
`--from github:org/repo`.

### Explore the playground

[`agent-playground/`](agent-playground/) is a complete workspace with real
workflows. `tagline` is a single agent writing one line. `showdown` puts
Claude and Codex on the same brief, has them score each other, and computes
the verdict in a script. `repo-audit` clones a repo, runs security scanners,
makes an agent verify every finding, and renders a report with fix prompts.

```bash
cd agent-playground
npm install
npx kraftwerk list
npx kraftwerk run tagline "https://nodehive.com"
```

## Run anywhere

Locally, a run happens on your machine. The agent CLIs use your existing
logins, commands touch your real files, output lands in `output/`. Use this
for work you trust on code you own.

With `--sandbox`, each run gets its own throwaway Docker container. The
workflow folder mounts read-only, the run directory mounts back to your host
`output/` so trace and artifacts show up live, and secrets come from
`runner.env`. Nothing else on your machine is reachable. That is how you let
an agent pick apart an untrusted repo without handing it your laptop.

```bash
npx kraftwerk runner build                                        # build the image once
npx kraftwerk run --sandbox --ssh repo-audit "git clone git@..."  # isolated container
npx kraftwerk runner ps                                           # list running sandboxes
```

On a server, copy [`deploy-starter/`](deploy-starter/) into your project as
`deploy/`. It builds a small Docker image with kraftwerk and the claude, codex
and pi CLIs, then serves that project's workspace behind traefik with
basic-auth. The auth is mandatory, not optional hardening. The chat runs
coding agents with full access to the mounted project.

```bash
cd deploy && cp .env.example .env && docker compose up -d --build
```

## Go deeper

The full YAML reference, gates, MCP servers, CLI grants, knowledge CLI and
harness details are in [`kraftwerk/README.md`](kraftwerk/README.md). Server
deployment details are in the starter's [README](deploy-starter/README.md).
