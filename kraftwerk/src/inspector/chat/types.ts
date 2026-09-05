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
  createdAt: string;
  updatedAt: string;
}

/** One thread event; `seq` orders them and drives SSE resume (?after=seq). */
export type ChatEvent =
  | { type: "user_message"; text: string }
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; callId: string; title: string; kind?: string; status?: string }
  | { type: "tool_update"; callId: string; title?: string; status?: string }
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
