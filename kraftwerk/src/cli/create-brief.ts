/**
 * `kraftwerk create "<spec>"` — printed for an LLM agent (Claude Code,
 * Codex, ...), veloop-style: the command does not scaffold anything itself,
 * it emits a self-contained brief the agent follows end to end with the
 * kraftwerk CLI. Everything the agent needs (schema essentials, an example
 * workflow.yml, gates, variables, harness rules, verify ladder) is inline —
 * no other files required reading.
 */
import { SCHEMA_URL } from "../config.js";

export function renderCreateBrief({
  spec,
  workflowsRoot,
}: {
  spec: string;
  workflowsRoot?: string;
}): string {
  const root = workflowsRoot ?? "src/workflows";
  return `# Create a new kraftwerk workflow

**Requirements:** ${spec}

You are scaffolding a YAML workflow for kraftwerk. A workflow is a
FOLDER \`${root}/<name>/\` containing \`workflow.yml\` (agents + gated steps)
and \`prompts/*.md\`. Deterministic code owns the control flow; agents work
inside bounded steps and are judged afterwards (envelope + file gates, with
in-session correction). The kraftwerk CLI discovers the folder automatically —
nothing to register.

## Steps

1. Orient: run \`kraftwerk list\` to see existing workflows (avoid name
   collisions, match local conventions).${workflowsRoot ? "" : ` No workflows root exists yet —
   create \`src/workflows/\` first.`}
2. Design from the requirements — keep it minimal and concrete:
   - **Steps** in order, two kinds: agent steps (\`agent\` + \`prompt\`) and
     deterministic script steps (\`run\`: a bash script — use these whenever
     no judgment is needed: fetching, measuring, converting). Only linear
     sequences fit YAML; if the requirements demand loops or human approval
     gates, STOP and tell the user this needs a TypeScript workflow instead.
   - **Agents**: one per role — persona (WHO), model + optional effort (WHAT
     thinks), tools (governance), \`runs-on\` (WHERE: claude | codex | pi).
   - **Gates** per step: what file evidence proves the step worked?
3. Write \`${root}/<name>/workflow.yml\`. Complete example of every feature:

   \`\`\`yaml
   # yaml-language-server: $schema=${SCHEMA_URL}
   name: tagline                # CLI name: kraftwerk run tagline "..."
   description: "One-liner shown in kraftwerk list"
   requires: [BRAND_API_TOKEN]  # optional: env vars checked before the run starts
   workspace: |
     Files: brand.md (analysis), tagline.md (result).
   mcp:                         # optional: MCP servers stored with the workflow
     calculator:
       command: node            # stdio server; relative files resolve in the folder
       args: [mcp/multiply-server.ts]
     linear:
       url: https://mcp.linear.app/mcp   # remote streamable HTTP
   clis:                        # optional: CLI grants, command prefix -> usage hint
     git: "Version control: commit after every step"
   agents:
     analyst:
       name: Brand analyst      # display name (optional)
       model: haiku             # model id in the harness's naming
       tools: [Read, Write, Edit, WebFetch]
       persona: |
         You analyze brands based on their website ...
     writer:
       runs-on: codex           # optional: claude (default) | codex | pi
       model: gpt-5.6-sol
       effort: high             # optional: low | medium | high | xhigh | max
       tools: [Read, Write, Edit]
       clis: [git]              # optional: CLI grant — hint lands in the persona
       mcp: [calculator]        # optional: MCP grant (governance, like tools)
       persona: prompts/writer-persona.md   # single line = file in this folder
   steps:
     - name: measure                        # deterministic step: bash, no agent
       run: scripts/measure.sh              # single line = file; or inline multiline bash
       gates:
         - file_non_empty: metrics.md
     - name: analyze
       agent: analyst
       prompt: prompts/analyze.md           # or inline multiline text
       gates:
         - file_non_empty: brand.md
         - contains: { file: brand.md, text: "## Tone of voice", label: tone }
     - name: write
       agent: writer
       prompt: prompts/write.md
       gates:
         - file_non_empty: tagline.md
         - slots_filled: tagline.md         # no unfilled {{...}} slots
   \`\`\`

4. Write the \`prompts/*.md\` files. Rules:
   - Available variables: \`\${{ request }}\` (the CLI argument) and
     \`\${{ agent }}\` (the step's agent id — lets several steps share one
     prompt file, e.g. writing \`verdict-\${{ agent }}.md\`).
   - Tell the agent exactly which files to read and write (relative names —
     they land in the run directory). The \`workspace:\` text must describe
     the file layout, because steps on different harnesses share state only
     through these files.
   - Do NOT mention envelopes — the engine appends that contract itself.
   Script steps (\`run:\`) execute with bash in the run directory: env vars
   \`REQUEST\`, \`RUN_DIR\`, \`PHASE\` are set and \`\${{ request }}\` is
   interpolated. Non-zero exit fails the run; gates apply but there is no
   correction loop (fix the script). A script MAY end its stdout with the
   same fenced \`\`\`json envelope agents emit (\`{"phase": "$PHASE",
   "status": "ok", "artifacts": [...], "summary": "..."}\`); otherwise the
   engine synthesizes one. Keep scripts in \`scripts/*.sh\` inside the folder.
5. MCP servers (only if the requirements need custom tools): store the
   server next to the workflow (e.g. \`mcp/multiply-server.ts\` using
   \`@modelcontextprotocol/sdk\` — its deps must be in the consumer's
   package.json; \`command: node\` runs TypeScript directly on node >= 24),
   declare it under top-level \`mcp:\`, grant it per agent via
   \`mcp: [name]\`. External servers: absolute \`command\` path or
   \`url:\` for remote streamable HTTP. Works on claude and codex;
   \`runs-on: pi\` rejects MCP at validation time.
   For EXISTING command-line tools use \`clis:\` instead of an MCP
   server: top-level map command prefix -> one-line usage hint, granted
   per agent via \`clis: [name]\`. The hint is injected into the persona
   once — NEVER repeat CLI usage in step prompts. claude scopes its Bash
   allowlist to \`Bash(<name>:*)\`; codex runs commands in its sandbox
   anyway; pi gets the plain bash tool.
6. Harness rules:
   - **claude** (default): any Claude model id; needs only the local login.
   - **codex**: ChatGPT login; models from the codex line (e.g.
     \`gpt-5.6-sol\`); a WebFetch/WebSearch grant in \`tools\` enables sandbox
     network access; persona is prepended to the prompt (no system-prompt flag).
   - **pi**: \`provider/id\` models (\`anthropic/...\` uses the Claude login;
     \`deepseek/...\`, \`openrouter/...\` need the vendor key — check with
     \`pi auth check --provider <p>\`).
   - Expensive models only where judgment matters; cheap models elsewhere.
7. Validate: \`kraftwerk validate ${root}/<name>\` — fix until it passes
   (strict schema: unknown keys are errors; semantic checks cover agent
   references, variables, referenced files).
8. Smoke: \`kraftwerk run <name> "<realistic request>"\` with all agents on a
   cheap model first (\`haiku\`, or codex which is free on subscription) —
   check every gate passes and the summary table renders. Then set the
   intended models.
9. Confirm to the user: workflow name, steps, roster (model/harness per
   agent), gates, and the artifact files a run produces.

## Notes

- Keep it minimal — only the steps/agents/gates the requirements actually
  call for. One agent serving several steps is normal (same persona, new
  task); several agents sharing one prompt file via \`\${{ agent }}\` too.
- Gates verify claims post-execution, never predictions. Prefer several
  small gates with precise failure texts (they drive the correction loop).
- If anything essential is unclear (target audience, output files, model
  budget), ask the user before writing files.`;
}
