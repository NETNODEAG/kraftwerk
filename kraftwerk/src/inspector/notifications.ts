import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getOutputDir } from "./context.js";
import type { ChatMeta } from "./chat/types.js";

/**
 * Attention items: things that happened while nobody was looking and that
 * the user should see — a session waiting for a permission answer, a routine
 * that finished or failed, a workflow run that ended. The inspector shows
 * them behind the bell in the top bar (count, list, browser notification);
 * this module is the one writer. Items are run-state, not config, so they
 * live in <output>/notifications.json (capped, newest first).
 *
 * Approval items carry a `key` so the same request is never listed twice
 * and disappears again the moment someone answers (dismissKey).
 */

export type NotificationKind = "approval" | "routine_done" | "routine_failed" | "run_done" | "run_failed";

/**
 * What a "diagnose" on a failure item should look at: a workflow run (chat
 * in the run folder) or a routine (its agent, and the session that failed
 * when there was one). The prompt is built when the chat starts, from the
 * current state of the run/session.
 */
export type DiagnoseRef =
  | { kind: "run"; runId: string }
  | { kind: "routine"; agent: string; routine: string; chatId?: string };

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** One line: who/what — "⏰ Morning digest needs approval". */
  title: string;
  /** Optional detail: the tool title, the summary's first lines, the error. */
  body?: string;
  /** Inspector route without the leading "#" — "/agents/<slug>/chat/<id>". */
  href: string;
  at: string;
  readAt?: string;
  /** Dedupe/dismiss handle for items that represent a live state. */
  key?: string;
  /** Present on failure items that a chat can investigate ("diagnose" in the bell). */
  diagnose?: DiagnoseRef;
}

export interface NotificationsView {
  items: Notification[];
  unread: number;
}

const MAX_ITEMS = 200;
const BODY_MAX = 280;

let cache: Notification[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

const file = (): string => path.join(getOutputDir(), "notifications.json");

async function load(): Promise<Notification[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8")) as unknown;
    cache = Array.isArray(parsed) ? (parsed as Notification[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(items: Notification[]): void {
  cache = items;
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(getOutputDir(), { recursive: true });
      await fs.writeFile(file(), JSON.stringify(items, null, 2));
    })
    .catch(() => {});
}

/** Trim a summary/error to a short body; first paragraph, no markdown noise. */
export function clipBody(text: string | undefined): string | undefined {
  const t = (text ?? "").replace(/\r/g, "").trim();
  if (!t) return undefined;
  const para = t.split(/\n{2,}/)[0].replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
  return para.length > BODY_MAX ? para.slice(0, BODY_MAX - 1).trimEnd() + "…" : para;
}

/** Inspector route for a chat — mirrors chatHref in the UI. */
export function chatHref(meta: ChatMeta): string {
  return meta.scope.kind === "agent" ? `/agents/${meta.scope.slug}/chat/${meta.id}` : `/agents/chats/${meta.id}`;
}

export async function pushNotification(input: {
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  key?: string;
  diagnose?: DiagnoseRef;
}): Promise<Notification> {
  const items = await load();
  const item: Notification = {
    id: randomUUID(),
    kind: input.kind,
    title: input.title,
    ...(input.body ? { body: clipBody(input.body) } : {}),
    href: input.href,
    at: new Date().toISOString(),
    ...(input.key ? { key: input.key } : {}),
    ...(input.diagnose ? { diagnose: input.diagnose } : {}),
  };
  // Same live state again (e.g. the request re-emitted): replace, don't stack.
  const rest = input.key ? items.filter((n) => n.key !== input.key) : items;
  persist([item, ...rest].slice(0, MAX_ITEMS));
  return item;
}

/** Drop the item(s) for a live state that no longer exists (a permission got answered). */
export async function dismissKey(key: string): Promise<void> {
  const items = await load();
  const next = items.filter((n) => n.key !== key);
  if (next.length !== items.length) persist(next);
}

export async function getNotification(id: string): Promise<Notification | null> {
  return (await load()).find((n) => n.id === id) ?? null;
}

export async function listNotifications(): Promise<NotificationsView> {
  const items = await load();
  return { items, unread: items.filter((n) => !n.readAt).length };
}

/** Mark the given ids (or everything) read. */
export async function markNotificationsRead(ids: string[] | "all"): Promise<NotificationsView> {
  const items = await load();
  const now = new Date().toISOString();
  const pick = ids === "all" ? null : new Set(ids);
  persist(items.map((n) => (!n.readAt && (!pick || pick.has(n.id)) ? { ...n, readAt: now } : n)));
  return listNotifications();
}

export async function clearNotifications(): Promise<void> {
  await load();
  persist([]);
}

/** Tests / project switches: forget the in-memory copy so the next read hits disk. */
export function resetNotificationsCache(): void {
  cache = null;
}
