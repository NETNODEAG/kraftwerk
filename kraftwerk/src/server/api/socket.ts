import { subscribeChat } from "../../core/chat/sessions.js";
import { watch } from "../live.js";
import { resolveVibeable, subscribeVibeable } from "../../core/vibeables.js";
import type { Workspace } from "../../core/workspace.js";
import { MACHINE_ROUTES, runInHub } from "../hub-context.js";
import type { Hub } from "../server.js";
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
  /** The workspace the message is for (its slug); absent: the connection's own. */
  ws?: unknown;
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
/**
 * `workspaceOf` finds the workspace a message is for: its `ws` (a slug), or
 * the connection's own (the one the socket was opened for) when it names
 * none. A daemon's socket opened at its root has no workspace of its own:
 * there, a message without `ws` reaches only the machine's routes (hub,
 * devices, protocol).
 */
export function serveSocket(
  conn: Socket,
  workspaceOf: (slug?: string) => Workspace | undefined,
  version: string,
  trust: Trust,
  recheck: () => Promise<Trust>,
  hub: Hub,
): void {
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

  /** A refusal answered the way the message expects one (its id, watch or sub key). */
  const refuse = (msg: Message, status: number, error: string) =>
    send({ id: msg.id, ...(typeof msg.watch === "string" ? { watch: msg.watch } : {}), ...(typeof msg.sub === "string" ? { sub: msg.sub } : {}), status, data: { error }, error });

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
    const slug = typeof msg.ws === "string" ? msg.ws : undefined;
    const ws = workspaceOf(slug);
    if (msg.ws !== undefined && !ws) return refuse(msg, 404, `no workspace "${String(msg.ws)}" here`);
    if (!ws && !(typeof msg.call === "string" && MACHINE_ROUTES.test(msg.call))) return refuse(msg, 404, "name a workspace: `ws` on the message");
    const run = (fn: () => Promise<void>) => runInHub(hub, () => (ws ? ws.run(fn) : fn()));
    void run(async () => {
      if (await stillPaired()) await handle(msg);
    }).catch((err: Error) => send({ id: msg.id, error: err.message }));
  });
  conn.onClose(() => {
    clearInterval(watchdog);
    // A subscription of a workspace that closed meanwhile has nothing left to let go of.
    for (const fn of stops.values()) {
      try {
        fn();
      } catch {}
    }
    stops.clear();
  });
  send({ hello: { protocol: PROTOCOL_VERSION, version } });
}
