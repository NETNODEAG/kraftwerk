import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import { parse } from "yaml";
import type { AgentDefinition } from "./agent.js";
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
 * Validation: structural pass against the JSON Schema (ajv) first, then
 * semantic checks (agent references, duplicate step names, variables,
 * referenced files). The engine appends the envelope contract to every step
 * prompt itself. Not in v1 (roadmap): approval loops, code steps,
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

function formatAjvErrors(errors: ErrorObject[], file: string): string {
  // oneOf mismatches (gates) explode into per-branch errors; keep it readable.
  const relevant = errors.filter((e) => e.keyword !== "oneOf" || !e.instancePath.includes("/gates/"));
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
  return `${file}: Schema-Validierung fehlgeschlagen\n${lines.map((l) => `  - ${l}`).join("\n")}${gateHint}`;
}

interface YamlStep {
  name: string;
  agent: AgentDefinition;
  prompt: string;
  gates: Gate[];
}

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
    if (line.includes("/") || /\.(md|txt)$/.test(line)) {
      return fail(`${field}: referenzierte Datei "${line}" nicht gefunden`);
    }
    return value.trim();
  };

  // 2) Semantic checks + resolution.
  const workspace = raw.workspace ? await resolveText(raw.workspace, "workspace") : "";

  const agents = new Map<string, AgentDefinition>();
  for (const [id, a] of Object.entries<any>(raw.agents)) {
    agents.set(id, {
      id,
      name: a.name ?? id,
      model: a.model,
      effort: a.effort,
      tools: a.tools,
      persona: await resolveText(a.persona, `agents.${id}.persona`),
      harness: a["runs-on"],
    });
  }

  const seen = new Set<string>();
  const steps: YamlStep[] = [];
  for (const [i, s] of (raw.steps as any[]).entries()) {
    const at = (message: string): never => fail(`steps[${i}]: ${message}`);
    if (seen.has(s.name)) at(`Step-Name "${s.name}" ist doppelt`);
    seen.add(s.name);
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
    const gates = (s.gates ?? []).map((g: any, j: number) =>
      buildGate(g, (message) => fail(`steps[${i}].gates[${j}]: ${message}`))
    );
    steps.push({ name: s.name, agent: agent!, prompt, gates });
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

      for (const step of steps) {
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
