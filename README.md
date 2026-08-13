# nn-agent-framework

Deterministic workflow-as-code over headless agent harnesses (`claude -p`,
`codex exec`, `pi`). "Agent proposes, code disposes."

| Folder | What |
| ------ | ---- |
| [`nn-agent-framework/`](nn-agent-framework/) | The framework package: agents (persona + model + tools + harness), bounded phases, envelopes, gates, per-harness sessions, YAML workflow folders + JSON Schema, the **kraftwerk** CLI. Start with its [README](nn-agent-framework/README.md). |
| [`agent-playground/`](agent-playground/) | Zero-code consumer: only YAML workflow folders — `tagline` (runs on codex) and `pitch` (jury pattern: one prompt file, three agents via `${{ agent }}`). |

```bash
cd agent-playground
npm install
npx kraftwerk list                              # discover + list workflows
npx kraftwerk run tagline "https://nodehive.com"
npx kraftwerk run                               # interactive picker
npx kraftwerk validate                          # schema + semantic checks
```

(`npm link` inside `nn-agent-framework/` makes `kraftwerk` a global command.)

Scaffold new workflows with the repo skill `/new-workflow`
([.claude/skills/new-workflow/](.claude/skills/new-workflow/)).
