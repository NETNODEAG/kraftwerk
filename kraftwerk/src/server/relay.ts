import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  daemonHandshake,
  exportKeyPair,
  generateKeyPair,
  importKeyPair,
  relayId,
  toBase64,
  fromBase64,
  toBase64Url,
  type Channel,
  type Hello,
  type KeyPair,
  type TunnelToClient,
  type TunnelToDaemon,
} from "../client/relay.js";
import { CLOUD_DEFAULT_URL } from "../config.js";

/**
 * The daemon's end of the relay (see src/client/relay.ts for the protocol):
 * an outgoing socket to the relay, one encrypted channel per client behind
 * it, and every request that comes through answered by this daemon's own
 * server — as a request from a network device, never as this machine. So a
 * client needs a paired device's token (or pairs with a code) exactly as on
 * the LAN.
 *
 * Machine settings live in ~/.kraftwerk/relay.json (owner-only): whether
 * the relay is on, which relay, the machine's key pair, and the secret the
 * relay knows it by (the first connection claims the machine's id; later
 * ones must present the same secret, so nobody else can take the id over).
 *
 * The relay socket, daemon side:
 *
 *   → {t:"auth", id, key, secret, version}     first
 *   ← {t:"ok"} | close 4401
 *   ← {t:"open", c} · {t:"msg", c, d} · {t:"close", c}
 *   → {t:"msg", c, d} · {t:"close", c}
 *   → {t:"ping"}  ← {t:"pong"}                  every 25 s; no pong in 60 s reconnects
 */

export interface RelaySettings {
  enabled: boolean;
  /** The cloud whose relay to use; the client endpoint and the pairing page derive from it. */
  url: string;
  publicKey: string;
  privateKey: JsonWebKey;
  secret: string;
}

export type RelayState = "off" | "connecting" | "connected" | "error";

export interface RelayStatus {
  state: RelayState;
  url?: string;
  /** The machine's id at the relay. */
  id?: string;
  /** The machine's public key (base64url) — what a pairing link carries. */
  key?: string;
  error?: string;
  /** Clients connected right now. */
  clients: number;
  since?: string;
}

const settingsFile = (): string => path.join(os.homedir(), ".kraftwerk", "relay.json");

export async function readRelaySettings(): Promise<RelaySettings | null> {
  try {
    const s = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as Partial<RelaySettings>;
    if (typeof s.publicKey !== "string" || !s.privateKey || typeof s.secret !== "string") return null;
    return { enabled: s.enabled === true, url: typeof s.url === "string" && s.url ? s.url : CLOUD_DEFAULT_URL, publicKey: s.publicKey, privateKey: s.privateKey, secret: s.secret };
  } catch {
    return null;
  }
}

async function writeRelaySettings(s: RelaySettings): Promise<void> {
  const file = settingsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Turn the relay on or off (creating the machine's key on first use); `url` switches relays. */
export async function setRelay(enabled: boolean, url?: string): Promise<RelaySettings> {
  let s = await readRelaySettings();
  if (!s) {
    const pair = await exportKeyPair(await generateKeyPair());
    s = { enabled, url: url || CLOUD_DEFAULT_URL, ...pair, secret: randomBytes(32).toString("base64url") };
  }
  s = { ...s, enabled, ...(url ? { url: url.replace(/\/+$/, "") } : {}) };
  await writeRelaySettings(s);
  return s;
}

/** wss://host/api/relay/<role> for a cloud URL. */
export const relayEndpoint = (cloudUrl: string, role: "server" | "client"): string =>
  `${cloudUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/api/relay/${role}`;

/**
 * The pairing page on the cloud's remote host, with what the phone needs in
 * the fragment (never sent to any server): the machine's key, and a pairing
 * code when one is given. `remote.<host>` unless the cloud says otherwise.
 */
export function remoteLink(cloudUrl: string, key: string, code?: string, remoteUrl = process.env.KRAFTWERK_REMOTE_URL): string {
  const base = remoteUrl?.replace(/\/+$/, "") || (() => {
    const u = new URL(cloudUrl);
    u.hostname = `remote.${u.hostname.replace(/^srv\./, "")}`;
    return u.origin;
  })();
  const params = new URLSearchParams({ k: key, ...(code ? { c: code.replace(/[^A-Za-z0-9]/g, "") } : {}), n: os.hostname().replace(/\.local$/, "") });
  return `${base}/_kw/#${params}`;
}

/** Headers a client may not choose: who it is, where it came from, how the hop works. */
const DROP_REQUEST = new Set([
  "host", "connection", "keep-alive", "upgrade", "te", "trailer", "transfer-encoding", "proxy-authorization",
  "cookie", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "content-length", "accept-encoding",
]);
/** Headers the client's Response cannot use or must not see. */
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "set-cookie", "content-length"]);
const CHUNK = 192 * 1024;
const PING_MS = 25_000;
const STALE_MS = 60_000;

interface Conn {
  channel: Channel | null;
  /** Requests in flight, by the client's id: aborting one destroys it. */
  inflight: Map<number, http.ClientRequest>;
  /** Opens and handles messages one after another: the channel counts them. */
  queue: Promise<unknown>;
}

export interface RelayLink {
  status(): RelayStatus;
  stop(): void;
}

export interface RelayOptions {
  /** This daemon's port: tunnelled requests go to 127.0.0.1:<port>. */
  port: number;
  settings: RelaySettings;
  version: string;
  /** Opens the relay socket (default: Node's global WebSocket) — tests pass their own. */
  connect?: (url: string) => WebSocket;
  log?: (line: string) => void;
}

/** Hold the daemon's socket to the relay, reconnecting with backoff, and answer every client behind it. */
export async function startRelay(opts: RelayOptions): Promise<RelayLink> {
  const keys: KeyPair = await importKeyPair(opts.settings);
  const id = await relayId(keys.publicKey);
  const url = relayEndpoint(opts.settings.url, "server");
  const log = opts.log ?? (() => {});
  const status: RelayStatus = { state: "connecting", url: opts.settings.url, id, key: opts.settings.publicKey, clients: 0 };
  const conns = new Map<string, Conn>();
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: NodeJS.Timeout | null = null;
  let pinger: NodeJS.Timeout | null = null;
  let lastHeard = 0;

  const send = (msg: unknown) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  };

  const dropConn = (c: string) => {
    const conn = conns.get(c);
    if (!conn) return;
    for (const r of conn.inflight.values()) r.destroy();
    conns.delete(c);
    status.clients = conns.size;
  };

  const reply = async (c: string, conn: Conn, msg: TunnelToClient) => {
    if (!conn.channel || !conns.has(c)) return;
    send({ t: "msg", c, d: await conn.channel.seal(JSON.stringify(msg)) });
  };

  /** One tunnelled request, answered by this daemon's own server as a network device's request. */
  const forward = (c: string, conn: Conn, req: Extract<TunnelToDaemon, { t: "req" }>) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) if (!DROP_REQUEST.has(k.toLowerCase())) headers[k.toLowerCase()] = String(v);
    const clientHost = typeof req.headers?.host === "string" && /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host) ? req.headers.host : "relay.invalid";
    // Marked as forwarded: trust.ts never takes a forwarded request for this machine, whatever its peer address.
    Object.assign(headers, { host: `127.0.0.1:${opts.port}`, "x-forwarded-for": "relay", "x-forwarded-host": clientHost, "x-forwarded-proto": "https", "x-kraftwerk-relay": "1" });
    const body = req.body ? Buffer.from(fromBase64(req.body)) : undefined;
    if (body) headers["content-length"] = String(body.length);
    const path = typeof req.url === "string" && req.url.startsWith("/") ? req.url : "/";
    const out = http.request({ host: "127.0.0.1", port: opts.port, method: req.method || "GET", path, headers }, (res) => {
      const h: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && !DROP_RESPONSE.has(k)) h[k] = Array.isArray(v) ? v.join(", ") : v;
      let chain = reply(c, conn, { t: "res", id: req.id, status: res.statusCode ?? 502, headers: h });
      res.on("data", (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i += CHUNK) {
          const part = chunk.subarray(i, i + CHUNK);
          chain = chain.then(() => reply(c, conn, { t: "data", id: req.id, chunk: toBase64(part) }));
        }
      });
      res.on("end", () => {
        conn.inflight.delete(req.id);
        chain = chain.then(() => reply(c, conn, { t: "end", id: req.id }));
      });
      res.on("error", () => {
        conn.inflight.delete(req.id);
        chain = chain.then(() => reply(c, conn, { t: "fail", id: req.id, error: "the response broke off" }));
      });
    });
    out.on("error", (err) => {
      if (!conn.inflight.has(req.id)) return; // aborted by the client
      conn.inflight.delete(req.id);
      void reply(c, conn, { t: "fail", id: req.id, error: err.message });
    });
    conn.inflight.set(req.id, out);
    out.end(body);
  };

  const onClientMessage = async (c: string, conn: Conn, d: string) => {
    if (!conn.channel) {
      try {
        const { ready, channel } = await daemonHandshake(keys, JSON.parse(d) as Hello);
        conn.channel = channel;
        send({ t: "msg", c, d: JSON.stringify(ready) });
      } catch (err) {
        log(`relay: handshake refused — ${(err as Error).message}`);
        send({ t: "close", c, reason: "handshake failed" });
        dropConn(c);
      }
      return;
    }
    let msg: TunnelToDaemon;
    try {
      msg = JSON.parse(await conn.channel.open(d)) as TunnelToDaemon;
    } catch {
      // A message that does not open is tampering or loss: this channel is done.
      send({ t: "close", c, reason: "bad message" });
      dropConn(c);
      return;
    }
    if (msg.t === "req" && typeof msg.id === "number") forward(c, conn, msg);
    else if (msg.t === "abort") {
      const r = conn.inflight.get(msg.id);
      conn.inflight.delete(msg.id);
      r?.destroy();
    }
  };

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.75 + Math.random() / 2);
    retry = setTimeout(connect, delay);
    retry.unref?.();
  };

  function connect(): void {
    if (stopped) return;
    status.state = "connecting";
    let socket: WebSocket;
    try {
      socket = opts.connect ? opts.connect(url) : new WebSocket(url);
    } catch (err) {
      status.state = "error";
      status.error = (err as Error).message;
      return schedule();
    }
    ws = socket;
    socket.addEventListener("open", () => {
      lastHeard = Date.now();
      socket.send(JSON.stringify({ t: "auth", id, key: opts.settings.publicKey, secret: opts.settings.secret, version: opts.version }));
    });
    socket.addEventListener("message", (ev: MessageEvent) => {
      lastHeard = Date.now();
      let msg: { t?: string; c?: string; d?: string; error?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === "ok") {
        attempt = 0;
        status.state = "connected";
        status.error = undefined;
        status.since = new Date().toISOString();
        log(`relay: connected to ${opts.settings.url} as ${id}`);
      } else if (msg.t === "open" && msg.c) {
        dropConn(msg.c);
        conns.set(msg.c, { channel: null, inflight: new Map(), queue: Promise.resolve() });
        status.clients = conns.size;
      } else if (msg.t === "msg" && msg.c && typeof msg.d === "string") {
        const conn = conns.get(msg.c);
        if (!conn) return;
        const c = msg.c;
        const d = msg.d;
        conn.queue = conn.queue.then(() => onClientMessage(c, conn, d)).catch(() => {});
      } else if (msg.t === "close" && msg.c) dropConn(msg.c);
    });
    socket.addEventListener("close", (ev: CloseEvent) => {
      if (ws !== socket) return;
      ws = null;
      for (const c of [...conns.keys()]) dropConn(c);
      if (stopped) return;
      status.state = "error";
      status.error = ev.code === 4401 ? `the relay refused this machine: ${ev.reason || "wrong secret"}` : ev.reason || "the relay connection closed";
      if (ev.code === 4401) log(`relay: ${status.error}`);
      schedule();
    });
    socket.addEventListener("error", () => {});
  }

  pinger = setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - lastHeard > STALE_MS) {
      // Silent for too long: the socket is dead without knowing it (a sleeping Mac, a lost route).
      const dead = ws;
      ws = null;
      for (const c of [...conns.keys()]) dropConn(c);
      try {
        dead.close();
      } catch {}
      status.state = "connecting";
      return schedule();
    }
    send({ t: "ping" });
  }, PING_MS);
  pinger.unref?.();

  connect();
  return {
    status: () => ({ ...status }),
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (pinger) clearInterval(pinger);
      for (const c of [...conns.keys()]) dropConn(c);
      try {
        ws?.close(1000, "bye");
      } catch {}
      ws = null;
      status.state = "off";
    },
  };
}

/** A short fingerprint of the machine key, to compare what a phone shows with what this machine shows. */
export const keyFingerprint = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 8).replace(/(.{4})/, "$1-");


/* ---------- the daemon's one link ---------- */

let link: RelayLink | null = null;

/** Start, restart or stop this daemon's relay link to match ~/.kraftwerk/relay.json. */
export async function applyRelay(port: number, version: string, log?: (line: string) => void): Promise<RelayStatus> {
  link?.stop();
  link = null;
  const settings = await readRelaySettings();
  if (settings?.enabled) link = await startRelay({ port, settings, version, log });
  return relayStatus();
}

/** The link's state; "off" when this process holds none (not the daemon, or the relay is off). */
export const relayStatus = (): RelayStatus => link?.status() ?? { state: "off", clients: 0 };

export function stopRelay(): void {
  link?.stop();
  link = null;
}
