import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import { parse } from "yaml";
import type { AgentDefinition } from "./agent.js";
import type { McpServerConfig } from "./harness.js";
import { envelopeContract } from "./envelope.js";
import { containsText, fileNonEmpty, slotsFilled, type Gate } from "./gates.js";
import { Run } from "./run.js";
import { runStamp, type WorkflowDefinition } from "./workflow.js";

/**
 * YAML-configured workflows (v1: a linear sequence of gated agent steps).
 * Vocabulary borrows from GitHub Actions: `steps`, `runs-on` (the harness),
 * `${{ request }}` / `${{ agent }}` interpolation.
 *
 * Canonical form is a FOLDER:
 *
 *   src/workflows/tagline/
 *     workflow.yml        # agents inline + steps; validated against
 *     prompts/            # schema/workflow.schema.json
 *       analysieren.md    # referenced from a step: `prompt: prompts/analysieren.md`
 *
 * In folder mode, single-line `prompt:`, `persona:`, and `workspace:` values
 * are treated as file references inside the folder; multiline values stay
 * inline. A single `.yml` file (everything inline) is still supported.
 *
 * Steps come in two kinds: agent steps (`agent` + `prompt`) and deterministic
 * script steps (`run`: a bash script, single-line value = file reference).
 *
 * MCP servers live alongside the workflow: a top-level `mcp:` map (stdio
 * command/args/env or remote url), agents opt in via `mcp: [names]` —
 * governance like tools. Relative server files (e.g. mcp/multiply-server.ts)
 * are resolved inside the folder.
 *
 * CLIs work the same way: a top-level `clis:` map (command prefix -> one-line
 * usage hint), agents opt in via `clis: [names]`. The hint is injected into
 * the agent's persona once — step prompts never repeat it.
 *
 * Validation: structural pass against the JSON Schema (ajv) first, then
 * semantic checks (agent references, duplicate step names, variables,
 * referenced files). The engine appends the envelope contract to every step
 * prompt itself. Not in v1 (roadmap): approval loops,
 * AGENTS.md-style context files, skills.
 */

const GATE_HINT =
  "Gates: file_non_empty: <datei> | slots_filled: <datei> | contains: {file, text, label?}";
const VARIABLES = ["request", "agent"];

let compiledSchema: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };

async function schemaValidator() {
  if (!compiledSchema) {
    const schema = JSON.parse(
      await readFile(new URL("../schema/workflow.schema.json", import.meta.url), "utf8")
    );
    compiledSchema = new Ajv({ allErrors: true }).compile(schema) as typeof compiledSchema;
  }
  return compiledSchema;
}

const STEP_HINT =
  "Step: agent-Step {name, agent, prompt, gates?} ODER script-Step {name, run, gates?}";
const MCP_HINT =
  "MCP-Server: {command, args?, env?} (stdio) ODER {url} (remote streamable HTTP)";
const CLI_HINT =
  "CLIs: <kommando-praefix>: <einzeiliger Hinweis> — Name z.B. git, ddev, npm run (keine Sonderzeichen)";

function formatAjvErrors(errors: ErrorObject[], file: string): string {
  // oneOf mismatches (gates, steps, mcp) explode into per-branch errors; keep it readable.
  const relevant = errors.filter(
    (e) => e.keyword !== "oneOf" || !/\/gates\/|\/steps\/\d+$|^\/mcp\//.test(e.instancePath)
  );
  const lines = relevant.slice(0, 4).map((e) => {
    const where = e.instancePath || "/";
    if (e.keyword === "additionalProperties") {
      return `${where}: unbekannter Schluessel "${(e.params as any).additionalProperty}"`;
    }
    if (e.keyword === "enum") {
      return `${where}: erlaubt sind ${(e.params as any).allowedValues?.join(", ")}`;
    }
    return `${where}: ${e.message}`;
  });
  const gateHint = errors.some((e) => e.instancePath.includes("/gates/")) ? `\n${GATE_HINT}` : "";
  const stepHint = errors.some((e) => e.keyword === "oneOf" && /\/steps\/\d+$/.test(e.instancePath))
    ? `\n${STEP_HINT}`
    : "";
  const mcpHint = errors.some((e) => e.instancePath.startsWith("/mcp/")) ? `\n${MCP_HINT}` : "";
  const cliHint = errors.some((e) => e.instancePath.startsWith("/clis")) ? `\n${CLI_HINT}` : "";
  return `${file}: Schema-Validierung fehlgeschlagen\n${lines.map((l) => `  - ${l}`).join("\n")}${gateHint}${stepHint}${mcpHint}${cliHint}`;
}

type YamlStep =
  | { kind: "agent"; name: string; agent: AgentDefinition; prompt: string; gates: Gate[] }
  | { kind: "script"; name: string; script: string; gates: Gate[] };

/** A YAML-loaded workflow additionally exposes its roster/steps (for the CLI). */
export interface LoadedWorkflow extends WorkflowDefinition {
  readonly meta: {
    agents: AgentDefinition[];
    steps: string[];
  };
}

/**
 * Load a workflow from a folder (`<dir>/workflow.yml` + referenced files)
 * or from a single `.yml`/`.yaml` file (everything inline).
 */
export async function loadWorkflow(givenPath: string): Promise<LoadedWorkflow> {
  const stats = await stat(givenPath).catch(() => null);
  if (!stats) throw new Error(`${givenPath}: nicht gefunden`);

  let yamlPath = givenPath;
  let baseDir: string | undefined;
  if (stats.isDirectory()) {
    baseDir = givenPath;
    const candidates = ["workflow.yml", "workflow.yaml"];
    const found = [];
    for (const c of candidates) {
      if (await stat(path.join(givenPath, c)).catch(() => null)) found.push(c);
    }
    if (found.length === 0) {
      throw new Error(`${path.basename(givenPath)}/: enthaelt keine workflow.yml`);
    }
    yamlPath = path.join(givenPath, found[0]);
  }
  const file = baseDir
    ? `${path.basename(baseDir)}/${path.basename(yamlPath)}`
    : path.basename(yamlPath);
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message}`);
  };

  let raw: any;
  try {
    raw = parse(await readFile(yamlPath, "utf8"));
  } catch (err) {
    return fail(`YAML nicht lesbar: ${(err as Error).message}`);
  }

  // 1) Structural validation against the JSON Schema.
  const validate = await schemaValidator();
  if (!validate(raw)) {
    throw new Error(formatAjvErrors(validate.errors ?? [], file));
  }

  // Single-line values in folder mode reference files inside the folder.
  const resolveText = async (value: string, field: string): Promise<string> => {
    const line = value.trim();
    if (!baseDir || line.includes("\n")) return value.trim();
    const candidate = path.resolve(baseDir, line);
    if (!candidate.startsWith(path.resolve(baseDir) + path.sep)) {
      return fail(`${field}: "${line}" liegt ausserhalb des Workflow-Ordners`);
    }
    const content = await readFile(candidate, "utf8").catch(() => null);
    if (content !== null) return content.trim();
    if (line.includes("/") || /\.(md|txt|sh)$/.test(line)) {
      return fail(`${field}: referenzierte Datei "${line}" nicht gefunden`);
    }
    return value.trim();
  };

  // 2) Semantic checks + resolution.
  const workspace = raw.workspace ? await resolveText(raw.workspace, "workspace") : "";

  // MCP servers stored alongside the workflow. Stdio args that resolve to a
  // file relative to the folder become absolute (the server process is later
  // spawned from the run directory); absolute paths and URLs pass through —
  // that's the external-MCP case.
  const mcpBase = baseDir ?? path.dirname(yamlPath);
  const mcpDefs = new Map<string, McpServerConfig>();
  for (const [name, cfg] of Object.entries<any>(raw.mcp ?? {})) {
    if ("url" in cfg) {
      mcpDefs.set(name, { url: cfg.url });
      continue;
    }
    const resolvedArgs: string[] = [];
    for (const arg of (cfg.args ?? []) as string[]) {
      if (path.isAbsolute(arg)) {
        resolvedArgs.push(arg);
        continue;
      }
      const candidate = path.resolve(mcpBase, arg);
      if (await stat(candidate).catch(() => null)) {
        resolvedArgs.push(candidate);
      } else if (/\.(ts|mts|cts|js|mjs|cjs|py|sh)$/.test(arg)) {
        fail(`mcp.${name}: Server-Datei "${arg}" nicht gefunden`);
      } else {
        resolvedArgs.push(arg); // flags like -y, package names like tsx
      }
    }
    mcpDefs.set(name, {
      command: cfg.command,
      ...(resolvedArgs.length > 0 ? { args: resolvedArgs } : {}),
      ...(cfg.env ? { env: cfg.env } : {}),
    });
  }

  // CLIs available to agents: command prefix -> one-line usage hint (may be
  // empty). Purely declarative; agents opt in below.
  const cliDefs = new Map<string, string>(
    Object.entries<any>(raw.clis ?? {}).map(([name, hint]) => [name, String(hint ?? "")])
  );

  const agents = new Map<string, AgentDefinition>();
  for (const [id, a] of Object.entries<any>(raw.agents ?? {})) {
    const mcp: Record<string, McpServerConfig> = {};
    for (const serverName of (a.mcp ?? []) as string[]) {
      const def = mcpDefs.get(serverName);
      if (!def) {
        fail(
          `agents.${id}.mcp: Server "${serverName}" ist unter mcp nicht definiert` +
            ` (vorhanden: ${[...mcpDefs.keys()].join(", ") || "—"})`
        );
      }
      mcp[serverName] = def!;
    }
    if (Object.keys(mcp).length > 0 && a["runs-on"] === "pi") {
      fail(`agents.${id}: runs-on "pi" unterstuetzt kein MCP — claude oder codex verwenden`);
    }
    const clis: Record<string, string> = {};
    for (const cliName of (a.clis ?? []) as string[]) {
      if (!cliDefs.has(cliName)) {
        fail(
          `agents.${id}.clis: CLI "${cliName}" ist unter clis nicht definiert` +
            ` (vorhanden: ${[...cliDefs.keys()].join(", ") || "—"})`
        );
      }
      clis[cliName] = cliDefs.get(cliName)!;
    }
    agents.set(id, {
      id,
      name: a.name ?? id,
      model: a.model,
      effort: a.effort,
      tools: a.tools,
      persona: await resolveText(a.persona, `agents.${id}.persona`),
      harness: a["runs-on"],
      ...(Object.keys(clis).length > 0 ? { clis } : {}),
      ...(Object.keys(mcp).length > 0 ? { mcp } : {}),
    });
  }

  const seen = new Set<string>();
  const steps: YamlStep[] = [];
  for (const [i, s] of (raw.steps as any[]).entries()) {
    const at = (message: string): never => fail(`steps[${i}]: ${message}`);
    if (seen.has(s.name)) at(`Step-Name "${s.name}" ist doppelt`);
    seen.add(s.name);
    const gates = (s.gates ?? []).map((g: any, j: number) =>
      buildGate(g, (message) => fail(`steps[${i}].gates[${j}]: ${message}`))
    );

    if (s.run !== undefined) {
      const script = await resolveText(s.run, `steps[${i}].run`);
      for (const match of script.matchAll(/\$\{\{\s*(\w+)\s*\}\}/g)) {
        if (match[1] !== "request") {
          at(`unbekannte Variable \${{ ${match[1]} }} — in run-Steps ist nur \${{ request }} verfuegbar (plus env: REQUEST, RUN_DIR, PHASE, WORKFLOW_DIR)`);
        }
      }
      steps.push({ kind: "script", name: s.name, script, gates });
      continue;
    }

    const agent = agents.get(s.agent);
    if (!agent) {
      at(`agent "${s.agent}" ist unter agents nicht definiert (vorhanden: ${[...agents.keys()].join(", ")})`);
    }
    const prompt = await resolveText(s.prompt, `steps[${i}].prompt`);
    for (const match of prompt.matchAll(/\$\{\{\s*(\w+)\s*\}\}/g)) {
      if (!VARIABLES.includes(match[1])) {
        at(`unbekannte Variable \${{ ${match[1]} }} — verfuegbar: ${VARIABLES.join(", ")}`);
      }
    }
    steps.push({ kind: "agent", name: s.name, agent: agent!, prompt, gates });
  }

  return {
    name: raw.name,
    description: raw.description,
    meta: {
      agents: [...agents.values()],
      steps: steps.map((s) => s.name),
    },

    async run({ request, verbose }) {
      const runDir = path.resolve("output", `run-${runStamp()}`);
      await mkdir(runDir, { recursive: true });

      const run = new Run({
        runDir,
        verbose,
        workspaceContext: [
          `Arbeitsverzeichnis (alle Dateien hier lesen und anlegen): ${runDir}`,
          workspace,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });

      await run.trace("run_start", {
        workflow: raw.name,
        description: raw.description,
        request,
        steps: steps.map((s) =>
          s.kind === "script"
            ? { name: s.name, kind: "script" }
            : { name: s.name, kind: "agent", agent: s.agent.id, model: s.agent.model }
        ),
      });

      for (const step of steps) {
        if (step.kind === "script") {
          await run.scriptPhase({
            name: step.name,
            script: step.script.replace(/\$\{\{\s*request\s*\}\}/g, request),
            gates: step.gates,
            env: {
              REQUEST: request,
              ...(baseDir ? { WORKFLOW_DIR: path.resolve(baseDir) } : {}),
            },
          });
          continue;
        }
        const prompt = step.prompt
          .replace(/\$\{\{\s*request\s*\}\}/g, request)
          .replace(/\$\{\{\s*agent\s*\}\}/g, step.agent.id);
        await run.agentPhase({
          name: step.name,
          agent: step.agent,
          prompt: `${prompt}\n\n${envelopeContract(step.name)}`,
          gates: step.gates,
        });
      }

      await run.printSummary();
      console.log(`\nArtifacts: ${runDir}`);
    },
  };
}

/** Back-compat alias for the single-file entry point. */
export const loadWorkflowYaml = loadWorkflow;

/** One YAML gate entry (single-key mapping, schema-checked) -> a Gate. */
function buildGate(g: any, at: (message: string) => never): Gate {
  const [gateName, value] = Object.entries(g)[0] as [string, any];
  switch (gateName) {
    case "file_non_empty":
      return fileNonEmpty(value);
    case "slots_filled":
      return slotsFilled(value);
    case "contains":
      return containsText(value.file, value.text, value.label ?? value.text);
    default:
      return at(`unbekanntes Gate "${gateName}" — ${GATE_HINT}`);
  }
}
