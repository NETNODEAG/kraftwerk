/** Chat state shared by the thread, the cards and the composer: the poster's name, what the event log says the agents are doing, and who speaks. */
import { createContext, useContext } from "react";
import type {
  Agent,
  AgentCommand,
  AuthStatus,
  Author,
  ChatScope,
  ConfigOption,
  PlanEntry,
  StoredChatEvent,
} from "../types";
import { api } from "../api";
import { PROJECT_ASSISTANT } from "../shared";

/** The name a human posts under in channels; per browser, changeable in the composer. */
const ME_KEY = "kw-me";
export function myName(): string {
  try {
    return localStorage.getItem(ME_KEY) || "";
  } catch {
    return "";
  }
}
export function setMyName(name: string): void {
  try {
    localStorage.setItem(ME_KEY, name);
  } catch {}
}

/** Interrupt one agent (channels) or every agent in a chat. */
export function stopAgent(chatId: string, agent?: string): void {
  void api.request("chats.cancel", { id: chatId, body: agent ? { agent } : {} }).catch(() => {});
}

const oneLine = (s: string, max = 90) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * A channel member's headline: `task` is the message that last addressed
 * it (what it works on), `now` its latest step in the running turn (the
 * tool it is using, else the start of what it is saying).
 */
export function agentActivity(events: StoredChatEvent[], slug: string): { task?: string; now?: string } {
  const mention = new RegExp(`(^|[^a-z0-9-])@${slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?![a-z0-9-])`, "i");
  let task: string | undefined;
  let now: string | undefined;
  let open = false;
  let said = "";
  for (const e of events) {
    const mine = e.from?.kind === "agent" && e.from.slug === slug;
    if (!mine) {
      if ((e.type === "user_message" || e.type === "text") && mention.test(e.text)) task = oneLine(e.text);
      continue;
    }
    switch (e.type) {
      case "turn_start":
        open = true;
        now = undefined;
        said = "";
        break;
      case "turn_end":
      case "error":
        open = false;
        break;
      case "tool_call":
        if (open) now = oneLine(`${e.kind && e.kind !== "other" ? `${e.kind}: ` : ""}${e.title}`);
        break;
      case "text":
        if (open) {
          said += e.text;
          if (!now || now.startsWith("says: ")) now = oneLine(`says: ${said}`);
        }
        break;
    }
  }
  return { task, now };
}

/**
 * What the agent last announced about itself: its plan, context and cost
 * use, slash commands, settings, and who it is signed in as. The last
 * event of each kind wins; channels keep each agent's own (by author).
 */
export function liveState(events: StoredChatEvent[], who?: Author) {
  const same = (from?: Author) => (!who && !from) || (who?.kind === "agent" && from?.kind === "agent" && from.slug === who.slug);
  let plan: PlanEntry[] | null = null;
  let usage: { used: number; size: number; costUsd?: number } | undefined;
  let commands: AgentCommand[] = [];
  let config: ConfigOption[] = [];
  let auth: AuthStatus | undefined;
  for (const e of events) {
    if (!same(e.from)) continue;
    if (e.type === "plan") plan = e.entries;
    else if (e.type === "usage") usage = { used: e.used, size: e.size, costUsd: e.costUsd };
    else if (e.type === "commands") commands = e.commands;
    else if (e.type === "config") config = e.options;
    else if (e.type === "auth") auth = e;
  }
  return { plan, usage, commands, config, auth };
}

/**
 * Who an agent's turn is from, the way a reader says it: "🐻 Max", "🎩 Ralv".
 * The waiting line, the approval and question cards and the composer all
 * name the agent instead of saying "the agent".
 */
export const SpeakerContext = createContext<(from?: Author) => string>(() => "The agent");
export const useSpeaker = () => useContext(SpeakerContext);

/** Who asked the first request nobody answered yet: undefined = none, null = the chat's one agent. */
export function pendingFrom(events: StoredChatEvent[]): Author | null | undefined {
  const open = new Map<string, Author | null>();
  for (const e of events) {
    if (e.type === "permission_request" || e.type === "elicitation_request") open.set(e.requestId, e.from ?? null);
    if (e.type === "permission_resolved" || e.type === "elicitation_resolved") open.delete(e.requestId);
  }
  return open.size ? [...open.values()][0] : undefined;
}

/** The name a chat's single agent goes by. */
export function mainSpeaker(scope: ChatScope, agents: Agent[], agentName?: string): string {
  if (scope.kind === "agent") {
    const a = agents.find((x) => x.slug === scope.slug);
    return a ? `${a.emoji ? `${a.emoji} ` : ""}${a.name}` : (agentName ?? scope.slug);
  }
  if (scope.kind === "general" || scope.kind === "kraftwerk") return "🎩 Ralv";
  if (scope.kind === "project") return `${PROJECT_ASSISTANT.emoji} ${PROJECT_ASSISTANT.name}`;
  return "The assistant";
}
