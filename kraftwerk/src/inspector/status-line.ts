import type { AgentStatus } from "./agent-status.js";

/**
 * The line under an agent's name in the rail, from its /api/agent-status
 * entry: the one thing that matters most right now. Waiting for you beats
 * working, working beats the next routine (when due within 36 hours), and
 * an agent with none of these says when it was last active, or falls back
 * to its description. Pure and import-free, so the inspector bundle and
 * the tests share it.
 */
export interface StatusLine {
  text: string;
  tone: "waiting" | "working" | "plain";
}

const ROUTINE_HORIZON_MS = 36 * 3600_000;

/** "just now", "5m", "3h", "2d" — elapsed time without the "ago". */
function span(ms: number): string {
  if (ms < 60e3) return "just now";
  const m = Math.floor(ms / 60e3);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** When a routine is due: "14:30" today, "tomorrow 07:00", else the weekday. */
function due(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function statusLine(st: AgentStatus | undefined, description = "", now = new Date()): StatusLine | null {
  if (!st) return description ? { text: description, tone: "plain" } : null;
  const where = (xs: AgentStatus["working"]) => `${xs[0].title || "a session"}${xs.length > 1 ? ` +${xs.length - 1}` : ""}`;
  if (st.waiting.length) return { text: `waiting for you · ${where(st.waiting)}`, tone: "waiting" };
  if (st.working.length) {
    const since = st.working[0].since;
    const elapsed = since ? span(Math.max(0, now.getTime() - Date.parse(since))) : "";
    return { text: `working · ${where(st.working)}${elapsed && elapsed !== "just now" ? ` · ${elapsed}` : ""}`, tone: "working" };
  }
  if (st.nextRoutine && Date.parse(st.nextRoutine.at) - now.getTime() < ROUTINE_HORIZON_MS) {
    return { text: `next: ${st.nextRoutine.name} · ${due(st.nextRoutine.at, now)}`, tone: "plain" };
  }
  if (st.lastActiveAt) {
    const ago = span(Math.max(0, now.getTime() - Date.parse(st.lastActiveAt)));
    return { text: ago === "just now" ? "last active just now" : `last active ${ago} ago`, tone: "plain" };
  }
  return { text: description || "no sessions yet", tone: "plain" };
}
