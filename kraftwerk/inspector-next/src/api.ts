/**
 * The slice of the inspector's /api this frontend uses. The shapes mirror
 * the server's own types (src/inspector/chat/types.ts, workflows.ts,
 * runs.ts, and /api/meta in server.ts); only the fields read here are typed.
 */

export interface SwitcherEntry {
  name: string;
  url: string;
  icon?: string;
  color?: string;
  /** true = running, false = known but stopped, absent = manual link from kraftwerk.yml. */
  live?: boolean;
  /** Absolute root (known workspaces only): the key for starting one. */
  root?: string;
  rootLabel?: string;
  /** false when the root folder is gone. */
  exists?: boolean;
}

export interface Meta {
  projectName: string;
  projectIcon: string;
  projectColor: string;
  projectRoot: string;
  projectRootLabel: string;
  switcher: SwitcherEntry[];
}

export type Harness = "claude" | "codex" | "pi";

export interface ChatMeta {
  id: string;
  agent: Harness;
  title: string;
  scope: { kind: string };
  updatedAt: string;
}

export type ChatEvent = { seq: number; ts: string } & (
  | { type: "user_message"; text: string }
  | { type: "text"; text: string; subagent?: string }
  | { type: "tool_call"; callId: string; title: string; status?: string; subagent?: string }
  | { type: "tool_update"; callId: string; title?: string; status?: string }
  | { type: "permission_request"; requestId: string; title: string; options: { optionId: string; name: string; kind?: string }[] }
  | { type: "permission_resolved"; requestId: string; optionId: string | null }
  | { type: "elicitation_request"; requestId: string; message: string }
  | { type: "elicitation_resolved"; requestId: string }
  | { type: "failure"; title: string; details?: string }
  | { type: "error"; message: string }
  | { type: "turn_end"; stopReason: string }
  // Everything else the server streams (thoughts, plans, usage, …) is ignored here.
  | { type: "other" }
);

export interface WorkflowSummary {
  slug: string;
  name?: string;
  description?: string;
  steps: number;
  usesRequest: boolean;
  error?: string;
}

export interface RunListItem {
  id: string;
  workflow?: string;
  status: "running" | "ok" | "failed" | "aborted";
  phasesDone: number;
  phasesTotal?: number;
  currentPhase?: string;
  awaitingDecision?: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const post = <T,>(url: string, body: unknown = {}): Promise<T> =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getMeta = () => request<Meta>("/api/meta");

export const startWorkspace = (root: string) =>
  post<{ ok?: boolean; live?: boolean; url?: string }>("/api/workspaces/start", { root });

export const listChats = () => request<{ chats: ChatMeta[] }>("/api/chats").then((d) => d.chats);

export const getChat = (id: string) => request<{ meta: ChatMeta; events: ChatEvent[]; busy: boolean }>(`/api/chats/${id}`);

export const createGeneralChat = (agent: Harness) => post<ChatMeta>("/api/chats", { agent, scope: { kind: "general" } });

export const sendMessage = (id: string, text: string) => post(`/api/chats/${id}/message`, { text });

export const cancelChat = (id: string) => post(`/api/chats/${id}/cancel`);

export const answerPermission = (id: string, requestId: string, optionId: string | null) =>
  post(`/api/chats/${id}/permission`, { requestId, optionId });

export const declineElicitation = (id: string, requestId: string) =>
  post(`/api/chats/${id}/elicitation`, { requestId, action: "decline" });

/** `root` is the absolute workflows folder; each workflow is `<root>/<slug>`. */
export const listWorkflows = () => request<{ root?: string; workflows: WorkflowSummary[] }>("/api/workflows");

/** Docker state for the sandbox; asked per workflow by the API, the same for all. */
export const sandboxReady = (slug: string) =>
  request<{ available?: boolean; image?: boolean }>(`/api/workflows/${encodeURIComponent(slug)}/run`)
    .then((d) => !!d.available && !!d.image)
    .catch(() => false);

export const runWorkflow = (slug: string, body: { request: string; sandbox: boolean }) =>
  post<{ runId: string }>(`/api/workflows/${encodeURIComponent(slug)}/run`, { ...body, ssh: false });

export const listRuns = () => request<{ runs: RunListItem[]; outputDir: string }>("/api/runs");

/**
 * Where the full inspector lives, for the screens this UI does not have
 * (a run's page). Built, it is the same server's root; in dev, the instance
 * the /api proxy points at (the `kw-target` cookie, see vite.config.ts).
 */
export function inspectorUrl(hash: string): string {
  if (!import.meta.env.DEV) return `/#${hash}`;
  const target = /(?:^|;\s*)kw-target=([^;]+)/.exec(document.cookie)?.[1];
  return `${target ? decodeURIComponent(target).replace(/\/+$/, "") : "http://localhost:1981"}/#${hash}`;
}
