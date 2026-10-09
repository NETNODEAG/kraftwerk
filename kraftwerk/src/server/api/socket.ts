import { subscribeChat } from "../../core/chat/sessions.js";
import { watch } from "../live.js";
import { resolveVibeable, subscribeVibeable } from "../../core/vibeables.js";
import type { Workspace } from "../../core/workspace.js";
import type { Trust } from "../trust.js";
import type { Socket } from "../ws.js";
import { apiRouter, PROTOCOL_VERSION, routes } from "./index.js";

/**
 * The control plane over one WebSocket (`/api/ws`): every JSON route by
 * name, live route results, and event streams — what a native app needs
 * from one connection, and what the web UI uses instead of polling.
 *
 * Server → client, first: `{hello: {protocol, version}}`.
 *
 * Client → server, each a JSON text message:
 * - `{id, call, input?}` runs route `call` (input = path params by name, `query`, `body`)
 *   → `{id, status, data}`. Raw and upload routes stay HTTP.
 * - `{watch: key, name, input?, interval?}` keeps a GET route's result live
 *   → `{watch: key, data}` now and whenever it changes. `{unwatch: key}` stops.
 * - `{sub: key, topic, after?}` follows an event stream: `chat.<id>` (events
 *   after seq `after`, then new ones) or `vibeable.<slug>` (file changes, dev
 *   server state) → `{event: key, data}` per event. `{unsub: key}` stops.
 *
 * `key`s are the client's own names, unique per connection. A refusal of a
 * message is `{id?, watch?, sub?, error}`.
 */

const DEFAULT_INTERVAL = 5000;

const GET_ROUTES = new Set(routes.filter((r) => r.method === "GET" && !r.raw).map((r) => r.name as string));

type Message = {
  id?: unknown;
  call?: unknown;
  input?: unknown;
  watch?: unknown;
  name?: unknown;
  interval?: unknown;
  unwatch?: unknown;
  sub?: unknown;
  topic?: unknown;
  after?: unknown;
  unsub?: unknown;
};

/** A device's standing is re-checked this often while its socket is open (and before each of its messages). */
const RECHECK_MS = 5_000;

/**
 * `recheck` re-derives the connection's trust (a device's token may have
 * been revoked since it connected): a device whose answer is no longer
 * `device` is disconnected at once (close code 4401).
 */
export function serveSocket(conn: Socket, workspace: Workspace, version: string, trust: Trust, recheck: () => Promise<Trust>): void {
  const trustKey = trust.kind === "device" ? `device:${trust.device.id}` : trust.kind;
  const stops = new Map<string, () => void>();
  const send = (msg: unknown) => conn.send(JSON.stringify(msg));
  const stop = (key: string) => {
    stops.get(key)?.();
    stops.delete(key);
  };
  const objectOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

  /** `placeholder` holds the key's place while the subscription is set up; a newer sub or unsub on the key replaces it. */
  async function follow(key: string, topic: string, after: number, placeholder: () => void): Promise<void> {
    const [kind, ...rest] = topic.split(".");
    const name = rest.join(".");
    let unsubscribe: (() => void) | null = null;
    // Only the key's current subscription speaks: a superseded one may still be replaying.
    const push = (data: unknown) => {
      const current = stops.get(key);
      if (current === placeholder || (current && current === unsubscribe)) send({ event: key, data });
    };
    if (kind === "chat" && name) unsubscribe = await subscribeChat(name, after, push).catch(() => null);
    else if (kind === "vibeable" && name) {
      const dir = await resolveVibeable(name).then((v) => v.dir, () => null);
      if (dir) unsubscribe = subscribeVibeable(name, dir, push);
    } else {
      if (stops.get(key) === placeholder) stops.delete(key);
      return send({ sub: key, error: `unknown topic ${topic}` });
    }
    if (!unsubscribe) {
      if (stops.get(key) === placeholder) stops.delete(key);
      return send({ sub: key, error: `no such ${kind}: ${name}` });
    }
    // Unsubscribed (or closed) while subscribing: let go at once.
    if (!conn.open || stops.get(key) !== placeholder) return unsubscribe();
    stops.set(key, unsubscribe);
  }

  async function handle(msg: Message): Promise<void> {
    if (typeof msg.call === "string") {
      const r = await apiRouter.invoke(msg.call, objectOf(msg.input), trust);
      return send({ id: msg.id, status: r.status, data: r.data });
    }
    if (typeof msg.watch === "string") {
      const key = msg.watch;
      const name = String(msg.name ?? "");
      if (!GET_ROUTES.has(name)) return send({ watch: key, error: `${name} cannot be watched` });
      const refused = apiRouter.allowed(name, trust);
      if (refused) return send({ watch: key, error: refused.error });
      const input = objectOf(msg.input);
      const interval = typeof msg.interval === "number" && msg.interval > 0 ? msg.interval : DEFAULT_INTERVAL;
      stop(key);
      stops.set(
        key,
        watch(
          // Shared by callers of the same standing only: a result may depend on who asks (devices.self).
          `${trustKey} ${name} ${JSON.stringify(input)}`,
          async () => {
            const r = await apiRouter.invoke(name, input, trust);
            return { ok: r.status < 300, data: r.data };
          },
          interval,
          (data) => send({ watch: key, data }),
        ),
      );
      return;
    }
    if (typeof msg.unwatch === "string") return stop(msg.unwatch);
    if (typeof msg.sub === "string" && typeof msg.topic === "string") {
      stop(msg.sub);
      const placeholder = () => {};
      stops.set(msg.sub, placeholder);
      return follow(msg.sub, msg.topic, Number(msg.after) || 0, placeholder);
    }
    if (typeof msg.unsub === "string") return stop(msg.unsub);
    send({ id: msg.id, error: "unknown message" });
  }

  /** Still the device that connected? Otherwise unpaired: drop the connection. */
  const stillPaired = async (): Promise<boolean> => {
    if (trust.kind !== "device") return true;
    const now = await recheck().catch((): Trust => ({ kind: "none" }));
    if (now.kind === "device" && now.device.id === trust.device.id) return true;
    conn.close(4401, "unpaired");
    return false;
  };
  const watchdog = trust.kind === "device" ? setInterval(() => void stillPaired(), RECHECK_MS) : undefined;
  watchdog?.unref?.();

  conn.onMessage((text) => {
    let msg: Message;
    try {
      msg = objectOf(JSON.parse(text)) as Message;
    } catch {
      return send({ error: "invalid JSON" });
    }
    // Every message runs in the connection's workspace, whatever started the read; a revoked device's message runs nowhere.
    void workspace
      .run(async () => {
        if (await stillPaired()) await handle(msg);
      })
      .catch((err: Error) => send({ id: msg.id, error: err.message }));
  });
  conn.onClose(() => {
    clearInterval(watchdog);
    for (const fn of stops.values()) fn();
    stops.clear();
  });
  send({ hello: { protocol: PROTOCOL_VERSION, version } });
}
