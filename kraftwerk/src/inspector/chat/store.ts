import { promises as fs } from "node:fs";
import path from "node:path";
import { getOutputDir } from "../context.js";
import type { ChatMeta, StoredChatEvent } from "./types.js";

/**
 * Chats live on disk under <output>/chats/<chat-id>/ as meta.json plus an
 * append-only events.jsonl — inspectable with plain tools and durable
 * across server restarts, like run folders.
 */

const chatsDir = (): string => path.join(getOutputDir(), "chats");

export function safeChatDir(id: string): string {
  if (!/^chat-[0-9a-z-]+$/.test(id)) throw new Error("invalid chat id");
  return path.join(chatsDir(), id);
}

export function newChatId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `chat-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function writeMeta(meta: ChatMeta): Promise<void> {
  const dir = safeChatDir(meta.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export async function readMeta(id: string): Promise<ChatMeta | null> {
  try {
    return upgradeMeta(JSON.parse(await fs.readFile(path.join(safeChatDir(id), "meta.json"), "utf8")));
  } catch {
    return null;
  }
}

/**
 * Chats written before 0.36 scoped agent sessions as
 * { kind: "team", member } — read them as { kind: "agent", slug } so the
 * folders on disk never need rewriting.
 */
function upgradeMeta(meta: ChatMeta): ChatMeta {
  const legacy = meta.scope as unknown as { kind: string; member?: string; routine?: string };
  if (legacy?.kind === "team" && typeof legacy.member === "string") {
    meta.scope = { kind: "agent", slug: legacy.member, ...(legacy.routine ? { routine: legacy.routine } : {}) };
  }
  return meta;
}

export async function appendEvent(id: string, ev: StoredChatEvent): Promise<void> {
  await fs.appendFile(path.join(safeChatDir(id), "events.jsonl"), JSON.stringify(ev) + "\n");
}

export async function readEvents(id: string): Promise<StoredChatEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(safeChatDir(id), "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  const events: StoredChatEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* partially written last line */
    }
  }
  return events;
}

export async function listChatMetas(): Promise<ChatMeta[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(chatsDir())).filter((e) => e.startsWith("chat-"));
  } catch {
    return [];
  }
  const metas = await Promise.all(entries.map(readMeta));
  return (metas.filter(Boolean) as ChatMeta[]).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}
