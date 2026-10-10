import { createCipheriv, randomBytes } from "node:crypto";
import { listAttention, type AttentionItem } from "../core/attention.js";
import { pushTargets } from "../core/devices.js";
import type { Hub } from "./server.js";

/**
 * Push notifications for what needs you: the daemon looks at every open
 * workspace's attention list (approvals, questions, failures) and, for each
 * item that is new, sends every device that asked for pushes a notification
 * through the relay — sealed with the key that device made for this machine
 * (AES-256-GCM), so the relay and Apple carry it without reading it. On the
 * phone, the app's notification extension opens it and shows the text; what
 * travels in the clear is only "something needs you" and the badge count.
 *
 *   → relay  {t:"push", pushes:[{token, environment, sealed, badge, thread}]}
 *   ← relay  {t:"push_invalid", token}     Apple says the token is gone
 *
 * Items present when the daemon starts are not pushed (a restart must not
 * ring every phone); a resolved item that comes back is new again.
 */

/** What a notification says, before it is sealed. The phone reads these names. */
export interface PushContent {
  title: string;
  body: string;
  subtitle?: string;
  /** The workspace (slug) and the chat to open on tap. */
  ws: string;
  chat?: string;
  kind: AttentionItem["kind"];
}

export interface PushMessage {
  token: string;
  environment: "sandbox" | "production";
  /** base64(nonce ‖ ciphertext ‖ tag) of the JSON PushContent. */
  sealed: string;
  badge: number;
  /** Groups a workspace's notifications on the phone. */
  thread: string;
}

/** Seal a notification's content with a device's key (base64, 32 bytes). */
export function sealPush(keyBase64: string, content: PushContent): string {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("a push key is 32 bytes");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(JSON.stringify(content), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64");
}

const LABEL: Record<AttentionItem["kind"], string> = { approval: "Approval", question: "Question", failed: "Failed" };

export function contentOf(item: AttentionItem, workspace: { slug: string; name: string }): PushContent {
  return {
    title: `${LABEL[item.kind] ?? "Needs you"} · ${workspace.name}`,
    body: item.title,
    ...(item.chatTitle ? { subtitle: item.chatTitle } : {}),
    ws: workspace.slug,
    ...(item.chatId ? { chat: item.chatId } : {}),
    kind: item.kind,
  };
}

export interface PushWatcher {
  /** Look now (tests; the timer does it every `everyMs`). */
  scan(): Promise<number>;
  stop(): void;
}

/**
 * Watch the hub's workspaces and hand each new item's notifications to `send`
 * (the relay link); returns how many were sent per scan.
 */
export function startPushWatcher(hub: Hub, send: (pushes: PushMessage[]) => boolean, everyMs = 10_000): PushWatcher {
  let seen: Set<string> | null = null;
  let running = false;

  const scan = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const now = new Map<string, { item: AttentionItem; ws: { slug: string; name: string } }>();
      for (const open of hub.list()) {
        const view = await open.ws.run(() => listAttention()).catch(() => null);
        for (const item of view?.items ?? []) now.set(`${open.slug}\n${item.id}`, { item, ws: { slug: open.slug, name: open.name } });
      }
      const first = seen === null;
      const fresh = first ? [] : [...now.entries()].filter(([k]) => !seen!.has(k)).map(([, v]) => v);
      seen = new Set(now.keys());
      if (!fresh.length) return 0;
      const targets = await pushTargets();
      if (!targets.length) return 0;
      const pushes: PushMessage[] = [];
      for (const { item, ws } of fresh) {
        const content = contentOf(item, ws);
        for (const t of targets) {
          pushes.push({ token: t.token, environment: t.environment, sealed: sealPush(t.key, content), badge: now.size, thread: ws.slug });
        }
      }
      return send(pushes) ? pushes.length : 0;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void scan().catch(() => {}), everyMs);
  timer.unref?.();
  return { scan, stop: () => clearInterval(timer) };
}
