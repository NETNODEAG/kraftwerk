# nn-agent-framework

Deterministic workflow-as-code over headless agent harnesses (`claude -p`,
`codex exec`, `pi`). "Agent proposes, code disposes."

| Folder | What |
| ------ | ---- |
| [`nn-agent-framework/`](nn-agent-framework/) | The framework package: agents (persona + model + tools + harness), bounded phases, envelopes, gates, per-harness sessions, YAML workflow folders + JSON Schema, CLI. Start with its [README](nn-agent-framework/README.md). |
| [`agent-playground/`](agent-playground/) | Consumer with example workflows: `tagline` (YAML folder, runs on codex) and `pitch` (jury pattern: one prompt file, three agents). |

```bash
cd agent-playground
npm install
npm start                                   # list workflows
npm start -- tagline "https://nodehive.com"
npm start -- validate src/workflows/tagline
```

Scaffold new workflows with the repo skill `/new-workflow`
([.claude/skills/new-workflow/](.claude/skills/new-workflow/)).
