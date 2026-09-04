import path from "node:path";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";
import { listAgents, toSummary, type AgentSummary } from "./agents.js";
import { currentInstanceUrl, discoverWorkspaces, listProjects } from "./instances.js";

/**
 * The ⌘K palette: every active agent in every workspace this machine
 * knows, so a user can jump to one without switching workspaces first.
 * This instance reads its own roster from disk; the others come from the
 * project registry, where each instance records its roster whenever it
 * reads it (see instances.ts). Stopped workspaces are listed too — the
 * palette starts them on the way to the agent.
 */

export interface WorkspaceAgents {
  name: string;
  icon?: string;
  /** Where the workspace's UI lives — hits link to `${url}/#/agents/<slug>`. */
  url: string;
  /** Project root (what /api/projects/start takes for a stopped workspace). */
  root?: string;
  /** The instance answering this request: hits navigate in place. */
  current: boolean;
  live: boolean;
  agents: AgentSummary[];
}

export interface AgentSearch {
  workspaces: WorkspaceAgents[];
}

export async function searchAgents(): Promise<AgentSearch> {
  const project = await resolveProject(getProjectRoot()).catch(() => null);
  const self: WorkspaceAgents = {
    name: project?.config.name ?? path.basename(project?.root ?? getProjectRoot()),
    icon: project?.config.icon || undefined,
    url: currentInstanceUrl() ?? "",
    root: project?.root ?? getProjectRoot(),
    current: true,
    live: true,
    agents: (await listAgents().catch(() => [])).filter((a) => !a.archived).map(toSummary),
  };
  const [workspaces, projects] = await Promise.all([discoverWorkspaces(), listProjects()]);
  const rosters = new Map(projects.map((p) => [p.root, p.agents ?? []]));
  const others = workspaces
    .filter((w) => w.root && w.exists !== false)
    .map((w): WorkspaceAgents => ({
      name: w.name,
      icon: w.icon,
      url: w.url,
      root: w.root,
      current: false,
      live: w.live,
      agents: rosters.get(w.root!) ?? [],
    }));
  return { workspaces: [self, ...others] };
}
