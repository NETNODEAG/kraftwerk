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
  /** The first message, shortened; empty until one was sent. */
  title: string;
  scope: { kind: string; slug?: string; routine?: string };
  updatedAt: string;
}

/** A chat as the list returns it. */
export type ChatSummary = ChatMeta & { busy: boolean; awaitingApproval: boolean };

/** A persistent agent of the workspace (agents/<slug>/agent.yml). */
export interface Agent {
  slug: string;
  name: string;
  emoji: string;
  description?: string;
  archived?: boolean;
}

/** Who said it — only on events of a channel, where several agents and people share one thread. */
export type Author = { kind: "human"; name: string } | { kind: "agent"; slug: string };

/** A conversation shared by several agents and people (channels/<slug>/channel.yml). It has exactly one chat. */
export interface Channel {
  slug: string;
  name: string;
  purpose?: string;
  /** Agent slugs. */
  members: string[];
  /** Answers messages that mention nobody. */
  responder?: string;
  chatId: string;
}

export type ChatEvent = { seq: number; ts: string; from?: Author } & (
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
  /** Channels: an agent starts working (pairs with the turn_end of the same author). */
  | { type: "turn_start" }
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

export const listChats = () => request<{ chats: ChatSummary[] }>("/api/chats").then((d) => d.chats);

export const listAgents = () => request<{ agents: Agent[] }>("/api/agents").then((d) => d.agents.filter((a) => !a.archived));

export const getChat = (id: string) => request<{ meta: ChatMeta; events: ChatEvent[]; busy: boolean }>(`/api/chats/${id}`);

export const createGeneralChat = (agent: Harness) => post<ChatMeta>("/api/chats", { agent, scope: { kind: "general" } });

/**
 * Everything agent.yml + system.md hold. A save rewrites both files from
 * what it is sent, so an edit starts from the loaded detail and sends every
 * field back — also the ones this UI has no control for (group, skills).
 */
export interface AgentDetail extends Agent {
  harness: Harness;
  model?: string;
  effort?: string;
  group?: string;
  workflows: string[];
  knowledge: string[];
  skills?: string[];
  /** The agent's role: its system prompt. */
  system: string;
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const getAgent = (slug: string) => request<AgentDetail>(`/api/agents/${encodeURIComponent(slug)}`);

/** With a slug: update that agent. Without: create one; the server derives the slug from the name. */
export const saveAgent = ({ slug, ...agent }: Omit<AgentDetail, "slug"> & { slug?: string }) =>
  request<AgentDetail>(slug ? `/api/agents/${encodeURIComponent(slug)}` : "/api/agents", {
    method: slug ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent),
  });

/** `root` is the absolute knowledge folder; each bundle is `<root>/<name>`. */
export const listKnowledge = () =>
  request<{ root?: string; bundles: { name: string; concepts: number; updatedAt?: string }[] }>("/api/knowledge");

/** A session with a persistent agent; the agent's own harness runs it. */
export const createAgentChat = (slug: string) => post<ChatMeta>("/api/chats", { scope: { kind: "agent", slug } });

/** `from` signs a message in a channel with the poster's name. */
export const sendMessage = (id: string, text: string, from?: string) => post(`/api/chats/${id}/message`, { text, ...(from ? { from } : {}) });

export const listChannels = () => request<{ channels: Channel[] }>("/api/channels").then((d) => d.channels);

export const cancelChat = (id: string) => post(`/api/chats/${id}/cancel`);

export const answerPermission = (id: string, requestId: string, optionId: string | null) =>
  post(`/api/chats/${id}/permission`, { requestId, optionId });

export const declineElicitation = (id: string, requestId: string) =>
  post(`/api/chats/${id}/elicitation`, { requestId, action: "decline" });

/** One step, as GET /api/workflows/:slug resolves it (prompt and script files read in). */
export interface WorkflowStep {
  name: string;
  kind: "agent" | "script";
  /** The workflow-level role that does an agent step. */
  agent?: string;
  prompt?: string;
  script?: string;
  /** The checks a step must pass, already as text. */
  gates: string[];
}

export interface WorkflowDetail {
  slug: string;
  name?: string;
  description?: string;
  steps: WorkflowStep[];
  files: string[];
}

export const getWorkflow = (slug: string) => request<WorkflowDetail>(`/api/workflows/${encodeURIComponent(slug)}`);

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
  return `${import.meta.env.DEV ? instanceOrigin() : ""}/#${hash}`;
}

/** The origin of the instance this page talks to: its own when built, the /api proxy's target in dev. */
export function instanceOrigin(): string {
  if (!import.meta.env.DEV) return window.location.origin;
  const target = /(?:^|;\s*)kw-target=([^;]+)/.exec(document.cookie)?.[1];
  return target ? decodeURIComponent(target).replace(/\/+$/, "") : "http://localhost:1981";
}

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

/** One knowledge page (an OKF concept) as a bundle lists it. */
export interface KnowledgePage {
  id: string;
  bundle: string;
  title: string;
  description?: string;
  trustTier: TrustTier;
  /** Past its stale_after date. */
  stale: boolean;
}

export const getBundle = (name: string) =>
  request<{ name: string; concepts: KnowledgePage[] }>(`/api/knowledge/${encodeURIComponent(name)}`);

/** A page with its markdown body. */
export const getPage = (bundle: string, id: string) =>
  request<KnowledgePage & { body: string }>(`/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(id)}`);

export const createBundle = (name: string) => post("/api/knowledge", { name });

/** Write one page (markdown with frontmatter). The server stamps it as written by a person and keeps the bundle's index and log. */
export const putPage = (bundle: string, id: string, content: string) =>
  post(`/api/knowledge/${encodeURIComponent(bundle)}/concept`, { id, content });

/**
 * Create a channel (the server derives the slug from the name and opens the
 * channel's one chat), or with a slug update it. An update only touches the
 * fields it is sent; `responder: ""` clears the responder.
 */
export const saveChannel = ({ slug, ...input }: { slug?: string; name: string; purpose: string; members: string[]; responder: string }) =>
  request<Channel>(slug ? `/api/channels/${encodeURIComponent(slug)}` : "/api/channels", {
    method: slug ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
