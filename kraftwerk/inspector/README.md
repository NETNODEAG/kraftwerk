# kraftwerk inspector

Web UI to look into the `output/` folder of a kraftwerk consumer project:
all runs at a glance, live phase timelines while a run executes, and every
file per run with inline preview (HTML reports render in place, text tails
live, images display).

## Architecture

Two halves, both in this package:

- **Server** — `src/inspector/` (part of the kraftwerk TypeScript build):
  a dependency-free `node:http` server that serves the JSON/file API and
  the prebuilt SPA. Started by `kraftwerk ui`.
- **Frontend** — this folder: a Vite + React SPA with hash routing
  (`#/runs/<id>`, `#/workflows`, `#/workflows/<slug>`). Built to `dist/`,
  which ships in the npm package — consumers install nothing and the UI
  starts instantly.

## Run

```bash
kraftwerk ui       # from any consumer project; --port, --output
```

In a dev checkout, `kraftwerk ui` builds `dist/` automatically on first
use. When working on the frontend itself, run the Vite dev server with
hot reload (proxies `/api` to a `kraftwerk ui` instance on 4499):

```bash
kraftwerk ui &     # API + last built frontend on :4499
cd inspector
npm install
npm run dev        # hot-reloading frontend on http://localhost:4498
```

After frontend changes, `npm run build` refreshes `dist/` (what
`kraftwerk ui` serves).

## What it shows

- **Run index** — every `run-*` folder: workflow, request, status lamp
  (ok / running / failed / aborted), phase progress, duration, cost.
  Running runs tick live.
- **Run detail** — the phase timeline parsed from `trace.jsonl`: agent +
  model chips, attempts, duration, token and cost figures, gate results
  (including failure messages), envelope summaries, and for the running
  phase the last tool activity. Steps that have not started yet appear as
  pending — the `run_start` trace event declares them.
- **Files** — all files of the run dir with size; click to view. `.html`
  renders in a sandboxed iframe (reports look like reports), images render
  inline, everything else is text with live tail while the run is active.
- **Workflows** — browses `src/workflows/` (or `workflows/`) of the same
  project: every workflow as a card, and per workflow a visualization of
  how it is built — agent cards (model, tools, persona) with identity
  colors, the step pipeline in order with each step's resolved prompt or
  script (file references are inlined), the gates per step, the workflow
  folder contents, and links to recent runs of that workflow. Broken
  YAML still shows up, flagged with its parse error.

- **Trigger runs** — every workflow page has a "trigger run" panel: enter a
  request and launch. Default is the **Docker sandbox** (one
  `kraftwerk-runner` container per run, workflow mounted read-only, run dir
  bind-mounted back into `output/` so the live timeline works unchanged;
  build the image once with `kraftwerk runner build`). Optional: forward
  the SSH agent, or run locally instead. Sandboxed runs show a "sandbox"
  chip and a stop button while running (`docker stop` under the hood).
  Env vars for sandboxed runs go into `<project>/runner.env`.

Realtime is plain polling (1.5 s while something runs, 6 s otherwise) —
no daemon, no socket, works on a plain filesystem.

## Requirements

Traces written by kraftwerk ≥ the `run_start` event carry workflow
name, request, and the declared step list; older traces still render, only
without those labels.
