/**
 * Chat data model shared across the chat backend modules. Every chat is a
 * folder under <output>/chats/ holding meta.json plus events.jsonl — the
 * same files-on-disk philosophy as runs. Events are the single source of
 * truth: the UI replays them to render the thread, and the SSE stream just
 * appends live ones.
 */

export type ChatAgentId = "claude" | "codex" | "pi";

export type ChatScope =
  | { kind: "general" }
  | { kind: "kraftwerk" }
  | { kind: "run"; runId: string }
  | { kind: "knowledge"; bundle?: string }
  | { kind: "agent"; slug: string; routine?: string }
  /** A project: the chat carries its brief, state, systems of record and links; see projects.ts. */
  | { kind: "project"; slug: string }
  /** A channel: several agents (and humans) share one transcript; see channels.ts. */
  | { kind: "channel"; slug: string };

/** Who produced an event. Absent on single-agent chats (the one human, the one agent). */
export type Author = { kind: "human"; name: string } | { kind: "agent"; slug: string };

export interface ChatMeta {
  id: string;
  agent: ChatAgentId;
  title: string;
  cwd: string;
  scope: ChatScope;
  /** Slug of the vibeable open in this chat's preview pane (cwd is its folder while set). */
  vibeable?: string;
  /**
   * The project this chat belongs to when its scope is not the project
   * itself: a channel that started as a project chat. Lists the chat under
   * the project and hands every seat the project's context.
   */
  project?: string;
  /**
   * The agent's own session id per seat ("main", or the agent slug in a
   * channel): after a restart or the idle reaper, the next backend resumes
   * it (session/resume) so the agent keeps its context instead of starting
   * over with the transcript as a summary.
   */
  sessions?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** A context compaction the agent ran, as reported on its synthetic tool call (`_meta.contextCompaction`). */
export interface Compaction {
  trigger?: "manual" | "automatic";
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
  error?: string;
}

/**
 * A failure the agent's session ran into, as the harness reports it
 * (AIR `sessionFailure`): what broke, how bad, and what a human can do.
 * The same `id` with a higher `revision` replaces an earlier report.
 */
export interface SessionFailure {
  id: string;
  revision: number;
  category: "connection" | "access" | "limit" | "request" | "service" | "unknown";
  severity: "warning" | "error";
  title: string;
  details?: string;
  /** Machine-readable refinement of the failure (e.g. why a login was refused). */
  reason?: string;
  actions: Array<"retry" | "login" | "new_session">;
}

/** One step of the agent's plan (Claude's todo list), as ACP reports it. */
export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** A slash command the agent offers (`available_commands_update`). */
export interface AgentCommand {
  name: string;
  description: string;
  /** What the command takes after its name, if anything. */
  hint?: string;
}

/** One session setting the agent lets the client change (`configOptions`). */
export type ConfigOption = {
  id: string;
  name: string;
  description?: string;
  /** model | thought_level | model_config | mode | ... (agent-defined) */
  category?: string;
} & (
  | { type: "select"; value: string; choices: Array<{ value: string; name: string; description?: string; group?: string }> }
  | { type: "boolean"; value: boolean }
);

/** Who the agent is signed in as (`_auth/status_update`). */
export interface AuthStatus {
  kind: "account" | "api_key" | "gateway" | "external" | "none";
  label: string;
  detail?: string;
  email?: string;
  organization?: string;
  plan?: string;
}

/** One field of a question the agent asks (an ACP form elicitation, e.g. Claude's AskUserQuestion). */
export interface ElicitationField {
  key: string;
  title?: string;
  description?: string;
  kind: "select" | "multiselect" | "text" | "number" | "boolean";
  options?: Array<{ value: string; label: string; description?: string }>;
  required?: boolean;
  /** A free-text alternative to the select above it ("Other"). */
  custom?: boolean;
}

/** A file that travels with a message (dropped or pasted into the composer); stored under the chat's folder. */
export interface Attachment {
  /** File name inside the chat's attachments/ folder (unique, safe). */
  name: string;
  mimeType: string;
  size: number;
}

export type ElicitationAnswer = { action: "accept"; content: Record<string, string | number | boolean | string[]> } | { action: "decline" } | { action: "cancel" };

/**
 * One thread event; `seq` orders them and drives SSE resume (?after=seq).
 * `subagent` on text/thought/tool events names the child session that
 * produced them (see the `subagent` event); absent = the main agent.
 */
export type ChatEvent =
  /** `steered`: handed into the running turn instead of starting the next one. */
  | { type: "user_message"; text: string; steered?: boolean; attachments?: Attachment[] }
  | { type: "text"; text: string; subagent?: string }
  | { type: "thought"; text: string; subagent?: string }
  | { type: "tool_call"; callId: string; title: string; kind?: string; status?: string; subagent?: string; compaction?: Compaction }
  | { type: "tool_update"; callId: string; title?: string; status?: string; subagent?: string; compaction?: Compaction }
  /** The agent delegated to a subagent running as its own session; its events follow tagged with `subagent: sessionId`. */
  | { type: "subagent"; sessionId: string; name: string; task: string }
  | { type: "subagent_state"; sessionId: string; state: "completed" | "failed" | "cancelled" | "disconnected" }
  /** Background work the agent started (a backgrounded shell, a monitor, a workflow) — outlives the tool call that started it. */
  | { type: "task"; taskId: string; name: string; taskType: string; description: string; toolCallId?: string; canStop?: boolean }
  | ({ type: "failure" } & SessionFailure)
  /** The agent's current plan; null when it dropped it. Replaces the previous one. */
  | { type: "plan"; entries: PlanEntry[] | null }
  /** Context window use (tokens used of size) and the session's cost so far. */
  | { type: "usage"; used: number; size: number; costUsd?: number }
  | { type: "commands"; commands: AgentCommand[] }
  | { type: "config"; options: ConfigOption[] }
  | ({ type: "auth" } & AuthStatus)
  /** What the agent says it changed this turn (AIR file change report); `unavailable` names why there is no list. */
  | { type: "files_changed"; paths: string[]; complete: boolean; uncertainty?: string; unavailable?: string }
  | { type: "elicitation_request"; requestId: string; message: string; fields: ElicitationField[] }
  | ({ type: "elicitation_resolved"; requestId: string } & ElicitationAnswer)
  | {
      type: "task_update";
      taskId: string;
      state?: "running" | "paused" | "completed" | "failed" | "stopped";
      description?: string;
      summary?: string;
      outputFilePath?: string;
    }
  | {
      type: "permission_request";
      requestId: string;
      title: string;
      options: Array<{ optionId: string; name: string; kind?: string }>;
    }
  | { type: "permission_resolved"; requestId: string; optionId: string | null }
  /** Channels: an agent starts working on the messages it was shown (pairs with turn_end by the same author). */
  | { type: "turn_start" }
  | { type: "turn_end"; stopReason: string }
  | { type: "error"; message: string };

export type StoredChatEvent = ChatEvent & { seq: number; ts: string; from?: Author };
