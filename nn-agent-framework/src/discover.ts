import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadWorkflow, type LoadedWorkflow } from "./yaml.js";

/**
 * Workflow auto-discovery for the kraftwerk CLI: a consumer needs no entry
 * file at all — every workflow folder (containing workflow.yml) and every
 * top-level .yml file under the workflows root is picked up automatically.
 *
 * Roots tried in order: src/workflows/, workflows/ (first existing wins).
 * Load failures are carried per entry instead of thrown, so `list` can show
 * broken workflows alongside valid ones.
 */

export interface DiscoveredWorkflow {
  path: string;
  workflow?: LoadedWorkflow;
  error?: string;
}

export async function discoverWorkflows(cwd: string): Promise<DiscoveredWorkflow[]> {
  let root: string | undefined;
  for (const candidate of ["src/workflows", "workflows"]) {
    const stats = await stat(path.join(cwd, candidate)).catch(() => null);
    if (stats?.isDirectory()) {
      root = path.join(cwd, candidate);
      break;
    }
  }
  if (!root) return [];

  const found: DiscoveredWorkflow[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    let candidate: string | undefined;
    if (entry.isDirectory()) {
      for (const f of ["workflow.yml", "workflow.yaml"]) {
        if (await stat(path.join(entryPath, f)).catch(() => null)) {
          candidate = entryPath;
          break;
        }
      }
    } else if (/\.ya?ml$/.test(entry.name)) {
      candidate = entryPath;
    }
    if (!candidate) continue;

    try {
      found.push({ path: candidate, workflow: await loadWorkflow(candidate) });
    } catch (err) {
      found.push({ path: candidate, error: (err as Error).message });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
