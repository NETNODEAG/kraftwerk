import { promises as fs } from "node:fs";
import path from "node:path";
import { agentsRoot, getAgent, safeAgentSlug } from "./agents.js";

/**
 * An agent's journal: agents/<slug>/journal.md, the agent's own memory
 * across sessions. What it learned, decided, promised and finished, one
 * line per entry stamped with its minute, under a dated heading, newest
 * first (like a project's log.md). Times are the machine's local time. The agent writes it through `kraftwerk journal` and reads the
 * recent part back at the start of every session, so next week it is the
 * same colleague; a human can add a line from the inspector.
 */

export const JOURNAL_FILE = "journal.md";
export const JOURNAL_KINDS = ["learned", "decided", "promised", "done", "note"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

async function journalPath(slug: string): Promise<string> {
  return path.join(await agentsRoot(), safeAgentSlug(slug), JOURNAL_FILE);
}

/** The whole journal; empty when nothing was written yet. */
export async function readJournal(slug: string): Promise<string> {
  return fs.readFile(await journalPath(slug), "utf8").catch(() => "");
}

/**
 * Prepend one entry under today's heading. `actor` is stamped unless it is
 * the agent itself: in its own journal, its own lines need no signature,
 * and a human's stand out.
 */
export async function appendJournal(slug: string, entry: string, opts: { kind?: string; actor?: string; now?: Date } = {}): Promise<string> {
  const def = await getAgent(slug);
  if (!def) throw new Error(`no agent "${slug}"`);
  const text = entry.trim().replace(/\s*\n\s*/g, " ");
  if (!text) throw new Error("entry is required");
  const kind = (opts.kind ?? "note").trim().toLowerCase();
  if (!(JOURNAL_KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of: ${JOURNAL_KINDS.join(", ")}`);
  const actor = opts.actor?.trim();
  const own = !actor || actor === slug || actor.startsWith(`${slug}/`);
  const now = opts.now ?? new Date();
  const line = `* ${clock(now)} ${kind === "note" ? "" : `**${kind[0].toUpperCase()}${kind.slice(1)}**: `}${text}${own ? "" : ` (${actor})`}`;

  const file = await journalPath(slug);
  const today = localDate(now);
  const raw = (await fs.readFile(file, "utf8").catch(() => null)) ?? `# ${def.name}'s journal\n`;
  const lines = mergeDays(raw).split("\n");
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
  if (todayIdx >= 0) {
    lines.splice(todayIdx + 1, 0, line);
  } else {
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    lines.splice(titleIdx + 1, 0, "", `## ${today}`, line);
  }
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(file, out);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM-DD in local time. */
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** HH:MM in local time. */
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * One section per day again, its entries newest first by their minute. Two
 * people adding to a journal on different machines both put a line under
 * the same day (or both open a new day); once git has kept both sides, the
 * next entry tidies the file: a day heading that appears twice is merged
 * into one, and stamped lines are ordered by time, ahead of older unstamped
 * ones, which keep their order.
 */
export function mergeDays(raw: string): string {
  const lines = raw.split("\n");
  const firstDay = lines.findIndex((l) => /^## /.test(l));
  if (firstDay < 0) return raw;
  const head = lines.slice(0, firstDay);
  const days = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of lines.slice(firstDay)) {
    const m = /^## (.+?)\s*$/.exec(l);
    if (m) {
      cur = days.get(m[1]) ?? [];
      days.set(m[1], cur);
    } else if (cur && l.trim()) {
      cur.push(l);
    }
  }
  if (days.size === lines.slice(firstDay).filter((l) => /^## /.test(l)).length) {
    // no day twice: leave the order of a day's lines as written
    return raw;
  }
  const stamp = (l: string) => /^\* (\d\d:\d\d) /.exec(l)?.[1] ?? "";
  const order = [...days.keys()].sort((a, b) => b.localeCompare(a));
  const body = order.map((d) => {
    const entries = days.get(d)!.map((l, i) => ({ l, i, t: stamp(l) }));
    entries.sort((a, b) => (a.t && b.t ? b.t.localeCompare(a.t) : a.t ? -1 : b.t ? 1 : 0) || a.i - b.i);
    return [`## ${d}`, ...[...new Set(entries.map((e) => e.l))]].join("\n");
  });
  return [...head, body.join("\n\n"), ""].join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * The recent part of a journal for a session's context: whole days, newest
 * first, until the budget is spent. Older days stay in the file, where the
 * agent can read them when it needs to.
 */
export function journalExcerpt(raw: string, budget = 4000): { text: string; truncated: boolean } {
  const days = raw.split(/\n(?=## )/).filter((d) => d.startsWith("## "));
  const kept: string[] = [];
  let used = 0;
  for (const d of days) {
    const day = d.trim();
    if (used + day.length > budget && kept.length > 0) break;
    kept.push(day.length > budget ? `${day.slice(0, budget)}…` : day);
    used += day.length;
  }
  return { text: kept.join("\n\n"), truncated: kept.length < days.length };
}
