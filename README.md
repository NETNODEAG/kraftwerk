# kraftwerk

Deterministic workflow-as-code over headless agent harnesses (`claude -p`,
`codex exec`, `pi`). "Agent proposes, code disposes."

| Folder | What |
| ------ | ---- |
| [`kraftwerk/`](kraftwerk/) | The framework package: agents (persona + model + tools + harness), bounded phases, envelopes, gates, per-harness sessions, YAML workflow folders + JSON Schema, the **kraftwerk** CLI. Start with its [README](kraftwerk/README.md). |
| [`agent-playground/`](agent-playground/) | Zero-code consumer: only YAML workflow folders — `tagline` (runs on codex), `pitch` (jury pattern: one prompt file, three agents via `${{ agent }}`), `rechner` (MCP server stored next to the workflow), `website-check` (script steps), `daily-stats` (CLI grants: the `my` CLI with a persona-injected usage hint), `repo-audit` (scanners as script steps + agent triage/review, HTML report with fix prompts). |

```bash
cd agent-playground
npm install
npx kraftwerk list                              # discover + list workflows
npx kraftwerk run tagline "https://nodehive.com"
npx kraftwerk run                               # interactive picker
npx kraftwerk validate                          # schema + semantic checks
```

(`npm link` inside `kraftwerk/` makes `kraftwerk` a global command.)

Scaffold new workflows with the repo skill `/new-workflow`
([.claude/skills/new-workflow/](.claude/skills/new-workflow/)).
