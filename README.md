# kraftwerk

Run AI agents as steps in a workflow, with your code in charge. You write the
sequence. The agent does the open-ended work inside each step. Deterministic
code checks whether it actually worked before the run moves on. "Agent
proposes, code disposes."

## Why

Most agent frameworks hand the whole job to a model and hope. That falls apart
the moment a step half-works, because nothing catches it and the mistake
compounds into the next step. kraftwerk flips who owns what. The control flow is
ordinary code. An agent gets one bounded task at a time, and every result has to
pass a check before the run continues. When a check fails, the agent fixes it in
the same conversation instead of starting from scratch.

There is no SDK to bind to. Each agent step shells out to a headless CLI
(`claude -p`, `codex exec`, or `pi`), so you can mix models from different
vendors in one workflow and change the model behind a step by editing one line.

## How a run works

A workflow is a list of steps, and each step is one of two kinds.

An **agent step** spawns a short-lived CLI process, hands it one task, and reads
back the result. The agent has to finish with a typed JSON envelope stating the
phase, status, artifacts, and a summary. Then code runs the step's gates against
the files on disk. A gate is a plain check, like "brand.md is non-empty" or
"report.html contains `</html>`". Pass every gate and the run moves on. Fail one
and its message goes back to the same agent session for another try, up to a
retry limit. A gate never trusts what the agent claims. It reads the files.

A **script step** is deterministic code, a bash script or a TS function. It
fetches, renders, or templates, anything that needs no judgment. Same envelope,
same gates, no model involved. The `website-check` and `repo-audit` scanners are
built this way.

Steps on the same harness share one resumed session, so a later step sees the
earlier conversation. Steps on different harnesses share state only through the
run's files. Every run writes a `trace.jsonl` event log and ends with a table of
time, tokens, and cost per step.

That is the whole idea. The rest is tooling around it.

## What's in here

| Folder | What |
| --- | --- |
| [`kraftwerk/`](kraftwerk/) | The framework, the `kraftwerk` CLI, the Docker sandbox runner, and the inspector web UI. Deep docs in its [README](kraftwerk/README.md). |
| [`agent-playground/`](agent-playground/) | A zero-code consumer. Only YAML workflow folders, no entry file. The best way to see real workflows. |

The playground workflows, roughly simplest to most involved:

- `tagline` reads a website and writes a tagline. Runs on codex.
- `pitch` runs a three-agent jury over one shared prompt file.
- `rechner` ships its own MCP server next to the workflow.
- `website-check` is all script steps, no model, and produces an HTML audit.
- `daily-stats` grants an agent one CLI, the `my` tool, with a usage hint.
- `repo-audit` clones a repo, runs security scanners, has an agent verify each
  finding and review the code by hand, then renders an HTML report with
  copy-paste fix prompts.

## Quickstart

```bash
cd agent-playground
npm install
npx kraftwerk list                          # discover and list workflows
npx kraftwerk run tagline "https://nodehive.com"
npx kraftwerk run                           # interactive picker
npx kraftwerk validate                      # schema and semantic checks
```

A workflow is pure config. Drop a folder with a `workflow.yml` under
`src/workflows/` and the CLI finds it, no registration. To scaffold one, use the
repo skill `/new-workflow`.

## Local or sandboxed runs

The same workflow runs either way. The only thing that changes is where the agent
processes execute, so you develop a workflow locally and later run it isolated
without touching the workflow itself.

By default a run happens right on your machine, in the consumer project. The agent
CLIs use your existing logins, commands touch your real files, and output lands in
`output/`. This is the fast path, and it is what you want for trusted work on your
own code.

Add `--sandbox` and each run goes into its own throwaway Docker container instead,
one per run. Inside the container:

- the workflow folder mounts read-only, so the agent cannot rewrite its own
  instructions
- the run directory bind-mounts back to your host `output/`, so the trace and
  artifacts show up live with no copy-back step
- secrets come from `runner.env`, plus a pass-through of `ANTHROPIC_API_KEY` and
  `OPENAI_API_KEY`
- nothing else on your machine is reachable

That isolation is the whole point. It is how you let an agent clone and pick apart
an untrusted repo without handing it your laptop. The container is thrown away
when the run ends, and `runner.json` in the run dir keeps the container name, exit
code, and timing.

```bash
npx kraftwerk runner build                                # build the image once
npx kraftwerk run repo-audit /path/to/local/repo          # local, no container
npx kraftwerk run --sandbox --ssh repo-audit "git clone git@..."   # isolated container
npx kraftwerk runner ps                                   # list running sandboxes
npx kraftwerk runner stop <run-id>                        # stop one
```

`--ssh` forwards your SSH agent into the container so it can clone private repos.
Local paths only work without the sandbox. A sandboxed run needs a git URL, since
the container has no access to the rest of your disk.

## Inspector

A Next.js app for watching runs. It shows a live phase timeline, the trace, and
every artifact per run, reading straight from `agent-playground/output/`. You can
also trigger a sandboxed run from the UI and jump right to it.

```bash
cd kraftwerk/inspector
npm run dev        # http://localhost:4499
```

For the primitives, the harness details, and the full YAML schema, read
[`kraftwerk/README.md`](kraftwerk/README.md).
