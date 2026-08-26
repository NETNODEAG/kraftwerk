import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";

/**
 * Workflow discovery + parsing for the inspector. Uses the same root
 * resolution as the CLI (kraftwerk.yml `workflows:` key, else src/workflows/
 * or workflows/) but parses the YAML raw, so even a workflow the framework
 * would reject still renders — with its error.
 */

async function workflowsRoot(): Promise<string | undefined> {
  const project = await resolveProject(getProjectRoot()).catch(() => null);
  return project?.workflowsRoot;
}

export interface AgentInfo {
  id: string;
  name?: string;
  model?: string;
  harness?: string;
  effort?: string;
  tools: string[];
  persona?: string;
}

export interface StepInfo {
  name: string;
  kind: "agent" | "script";
  agent?: string;
  /** Resolved prompt text (agent steps). */
  prompt?: string;
  /** The file reference as written in the yml, if the value was a file ref. */
  sourceRef?: string;
  /** Resolved script text (script steps). */
  script?: string;
  gates: string[];
}

export interface WorkflowSummary {
  slug: string;
  name?: string;
  description?: string;
  agents: number;
  steps: number;
  error?: string;
}

export interface WorkflowDetail {
  slug: string;
  dir: string;
  name?: string;
  description?: string;
  workspace?: string;
  agents: AgentInfo[];
  steps: StepInfo[];
  files: string[];
  error?: string;
}

function gateLabel(g: any): string {
  if (g == null) return "?";
  if (typeof g.file_non_empty === "string") return `file_non_empty(${g.file_non_empty})`;
  if (typeof g.slots_filled === "string") return `slots_filled(${g.slots_filled})`;
  if (g.contains) return `contains(${g.contains.file}, ${g.contains.label ?? g.contains.text})`;
  return JSON.stringify(g);
}

/** Folder mode: a single-line value references a file inside the folder. */
async function resolveText(
  value: unknown,
  baseDir: string | null
): Promise<{ text?: string; sourceRef?: string }> {
  if (typeof value !== "string") return {};
  const line = value.trim();
  if (!baseDir || line.includes("\n")) return { text: line };
  const candidate = path.resolve(baseDir, line);
  if (!candidate.startsWith(path.resolve(baseDir) + path.sep)) return { text: line };
  const content = await fs.readFile(candidate, "utf8").catch(() => null);
  if (content !== null) return { text: content.trim(), sourceRef: line };
  return { text: line };
}

async function listDirFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      out.push(...(await listDirFiles(path.join(dir, e.name), `${prefix}${e.name}/`)));
    } else {
      out.push(`${prefix}${e.name}`);
    }
  }
  return out.sort();
}

interface Located {
  slug: string;
  yamlPath: string;
  baseDir: string | null;
}

async function locate(): Promise<Located[]> {
  const root = await workflowsRoot();
  if (!root) return [];
  const found: Located[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const f of ["workflow.yml", "workflow.yaml"]) {
        const st = await fs.stat(path.join(entryPath, f)).catch(() => null);
        if (st?.isFile()) {
          found.push({ slug: entry.name, yamlPath: path.join(entryPath, f), baseDir: entryPath });
          break;
        }
      }
    } else if (/\.ya?ml$/.test(entry.name)) {
      found.push({ slug: entry.name.replace(/\.ya?ml$/, ""), yamlPath: entryPath, baseDir: null });
    }
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function parseRaw(l: Located): Promise<any> {
  const text = await fs.readFile(l.yamlPath, "utf8");
  return parseYaml(text);
}

export async function listWorkflows(): Promise<{ root?: string; workflows: WorkflowSummary[] }> {
  const root = await workflowsRoot();
  const located = await locate();
  const workflows = await Promise.all(
    located.map(async (l): Promise<WorkflowSummary> => {
      try {
        const raw = await parseRaw(l);
        return {
          slug: l.slug,
          name: raw?.name,
          description: raw?.description,
          agents: Object.keys(raw?.agents ?? {}).length,
          steps: (raw?.steps ?? []).length,
        };
      } catch (err) {
        return { slug: l.slug, agents: 0, steps: 0, error: (err as Error).message };
      }
    })
  );
  return { root, workflows };
}

export async function getWorkflow(slug: string): Promise<WorkflowDetail | null> {
  const located = await locate();
  const l =
    located.find((x) => x.slug === slug) ??
    // Fallback: match by workflow name (run traces carry the name, not the slug).
    (await (async () => {
      for (const x of located) {
        try {
          if ((await parseRaw(x))?.name === slug) return x;
        } catch {}
      }
      return undefined;
    })());
  if (!l) return null;

  let raw: any;
  try {
    raw = await parseRaw(l);
  } catch (err) {
    return {
      slug: l.slug,
      dir: path.dirname(l.yamlPath),
      agents: [],
      steps: [],
      files: [],
      error: (err as Error).message,
    };
  }

  const agents: AgentInfo[] = [];
  for (const [id, a] of Object.entries<any>(raw?.agents ?? {})) {
    const persona = await resolveText(a?.persona, l.baseDir);
    agents.push({
      id,
      name: a?.name,
      model: a?.model,
      harness: a?.harness,
      effort: a?.effort,
      tools: a?.tools ?? [],
      persona: persona.text,
    });
  }

  const steps: StepInfo[] = [];
  for (const s of raw?.steps ?? []) {
    const gates = (s?.gates ?? []).map(gateLabel);
    if (s?.run !== undefined) {
      const script = await resolveText(s.run, l.baseDir);
      steps.push({
        name: s.name,
        kind: "script",
        script: script.text,
        sourceRef: script.sourceRef,
        gates,
      });
    } else {
      const prompt = await resolveText(s?.prompt, l.baseDir);
      steps.push({
        name: s?.name,
        kind: "agent",
        agent: s?.agent,
        prompt: prompt.text,
        sourceRef: prompt.sourceRef,
        gates,
      });
    }
  }

  const workspace = await resolveText(raw?.workspace, l.baseDir);

  return {
    slug: l.slug,
    dir: path.dirname(l.yamlPath),
    name: raw?.name,
    description: raw?.description,
    workspace: workspace.text,
    agents,
    steps,
    files: l.baseDir ? await listDirFiles(l.baseDir) : [path.basename(l.yamlPath)],
  };
}
