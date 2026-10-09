import type { ApiName, ApiResult, CallInput, Client } from "./index.js";

/**
 * Live data over the control plane's socket (/api/ws): route results that
 * stay current (`watch`) and event streams (`subscribe`). One connection
 * carries them all; the server pushes a watched result when it changes,
 * and replays a chat's events from the last one seen after a reconnect.
 *
 * Without a socket — none in this runtime, or the connection is down — a
 * watch polls over HTTP at its interval and a stream uses the server-sent
 * events route where the runtime has EventSource, so callers never notice
 * which one they got. One-off calls stay on the HTTP client.
 */

export interface WatchOptions {
  /** How stale the result may get when nothing announces a change, in ms (default 6 s). */
  interval?: number;
}

export interface Live {
  watch<N extends ApiName>(name: N, input: CallInput<N> | undefined, opts: WatchOptions, onData: (data: ApiResult<N>) => void): () => void;
  /** `chat.<id>` (from the event after seq `after`) or `vibeable.<slug>`. */
  subscribe(topic: string, opts: { after?: number }, onEvent: (event: unknown) => void): () => void;
  /** Whether the socket is up (else watches poll and streams use EventSource). */
  readonly connected: boolean;
  close(): void;
}

export interface LiveOptions {
  /** The HTTP client: its baseUrl (workspace prefix included) is where the socket connects too. */
  client: Client;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
}

interface WatchEntry {
  name: ApiName;
  input: Record<string, unknown>;
  interval: number;
  onData: (data: never) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface SubEntry {
  topic: string;
  after: number;
  onEvent: (event: unknown) => void;
  source?: EventSource;
}

const MAX_BACKOFF = 10_000;

export function createLive(opts: LiveOptions): Live {
  const WS = opts.WebSocket ?? (typeof WebSocket === "undefined" ? undefined : WebSocket);
  const ES = opts.EventSource ?? (typeof EventSource === "undefined" ? undefined : EventSource);
  const { client } = opts;
  const watches = new Map<string, WatchEntry>();
  const subs = new Map<string, SubEntry>();
  let socket: WebSocket | null = null;
  let connected = false;
  let closed = false;
  let backoff = 500;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let counter = 0;

  const socketUrl = (): string => {
    // The client's base carries the workspace prefix; a relative one is on this page's origin.
    const base = /^https?:/.test(client.baseUrl) ? client.baseUrl : (typeof location === "undefined" ? "" : location.origin) + client.baseUrl;
    // A browser's socket carries the device cookie; other runtimes cannot send headers on a WebSocket, so the token rides in the query.
    return `${base.replace(/^http/, "ws").replace(/\/+$/, "")}/api/ws${client.token ? `?token=${encodeURIComponent(client.token)}` : ""}`;
  };
  const send = (msg: unknown) => {
    if (connected) socket?.send(JSON.stringify(msg));
  };

  /* ---------- fallbacks ---------- */

  const poll = (key: string) => {
    const w = watches.get(key);
    if (!w || connected) return;
    clearTimeout(w.timer);
    void (client.request as (n: ApiName, i: unknown) => Promise<{ ok: boolean; data: unknown }>)(w.name, w.input)
      .then((r) => r.ok && watches.get(key) === w && !connected && w.onData(r.data as never))
      .catch(() => {})
      .finally(() => {
        if (watches.get(key) === w && !connected) w.timer = setTimeout(() => poll(key), w.interval);
      });
  };

  const stream = (key: string) => {
    const s = subs.get(key);
    if (!s || connected || s.source || !ES) return;
    const [kind, ...rest] = s.topic.split(".");
    const name = rest.join(".");
    const url =
      kind === "chat"
        ? client.url("chats.events", { id: name, query: { after: s.after } })
        : kind === "vibeable"
          ? client.url("vibeables.events", { slug: name })
          : "";
    if (!url) return;
    s.source = new ES(url);
    s.source.onmessage = (m) => deliver(key, JSON.parse(m.data as string));
  };

  const deliver = (key: string, data: unknown) => {
    const s = subs.get(key);
    if (!s) return;
    const seq = (data as { seq?: unknown } | null)?.seq;
    if (typeof seq === "number") {
      // A replay after a reconnect may overlap what arrived already.
      if (seq <= s.after) return;
      s.after = seq;
    }
    s.onEvent(data);
  };

  // Over the socket the server pushes after a change; while polling, this client's own change re-polls at once.
  const stopOnChange = client.onChange(() => {
    if (!connected) for (const key of watches.keys()) poll(key);
  });

  /* ---------- the socket ---------- */

  const resume = () => {
    for (const [key, w] of watches) {
      clearTimeout(w.timer);
      send({ watch: key, name: w.name, input: w.input, interval: w.interval });
    }
    for (const [key, s] of subs) {
      s.source?.close();
      s.source = undefined;
      send({ sub: key, topic: s.topic, after: s.after });
    }
  };

  const fallBack = () => {
    for (const key of watches.keys()) poll(key);
    for (const key of subs.keys()) stream(key);
  };

  const connect = () => {
    if (closed || socket || !WS) return;
    let ws: WebSocket;
    try {
      ws = new WS(socketUrl());
    } catch {
      return fallBack();
    }
    socket = ws;
    ws.onopen = () => {
      connected = true;
      backoff = 500;
      resume();
    };
    ws.onmessage = (m) => {
      let msg: { watch?: string; event?: string; data?: unknown };
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (msg.watch && "data" in msg) watches.get(msg.watch)?.onData(msg.data as never);
      else if (msg.event) deliver(msg.event, msg.data);
    };
    ws.onclose = () => {
      socket = null;
      connected = false;
      if (closed) return;
      fallBack();
      retry = setTimeout(connect, backoff);
      backoff = Math.min(MAX_BACKOFF, backoff * 2);
    };
  };


  return {
    get connected() {
      return connected;
    },
    watch(name, input, o, onData) {
      const key = `w${++counter}`;
      watches.set(key, { name, input: (input ?? {}) as Record<string, unknown>, interval: o.interval ?? 6000, onData: onData as (d: never) => void });
      if (connected) send({ watch: key, name, input: input ?? {}, interval: o.interval ?? 6000 });
      else {
        // Until the socket is up (or for good, without one), poll.
        poll(key);
        connect();
      }
      return () => {
        clearTimeout(watches.get(key)?.timer);
        watches.delete(key);
        send({ unwatch: key });
      };
    },
    subscribe(topic, o, onEvent) {
      const key = `s${++counter}`;
      subs.set(key, { topic, after: o.after ?? 0, onEvent });
      if (connected) send({ sub: key, topic, after: o.after ?? 0 });
      else {
        stream(key);
        connect();
      }
      return () => {
        subs.get(key)?.source?.close();
        subs.delete(key);
        send({ unsub: key });
      };
    },
    close() {
      closed = true;
      stopOnChange();
      clearTimeout(retry);
      socket?.close();
      for (const w of watches.values()) clearTimeout(w.timer);
      for (const s of subs.values()) s.source?.close();
      watches.clear();
      subs.clear();
    },
  };
}
