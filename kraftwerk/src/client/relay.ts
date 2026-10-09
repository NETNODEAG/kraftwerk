/**
 * The relay: reaching a machine's kraftwerk from anywhere, end to end
 * encrypted. The daemon holds an outgoing socket to a relay (kraftwerk
 * cloud); a client — a phone's browser, an app — opens a socket to the same
 * relay naming the machine, and the relay pipes the two together. The relay
 * sees who talks to which machine, when, and how much; never what.
 *
 * This module is both ends of the encryption and the client's half of the
 * tunnel. It runs wherever WebCrypto does (Node 20+, browsers, service
 * workers), so the daemon, the CLI and the phone share one implementation.
 *
 * Keys. The daemon has a long-lived X25519 key; its public half is the
 * pairing link's trust anchor (`#k=…`), and the relay knows the machine by
 * its hash (`relayId`). Each connection:
 *
 *   client → daemon   {t:"hello", v:1, key: e_c}                  plaintext
 *   daemon → client   {t:"ready", key: e_d, box: seal("ready")}   plaintext + sealed proof
 *
 * Both derive two AES-256-GCM keys (one per direction) with HKDF-SHA256 from
 * DH(e_c, S_d) ‖ DH(e_c, e_d), salted with e_c ‖ S_d ‖ e_d. Only the holder
 * of S_d can open the client's traffic or produce "ready" (the client knows
 * it reached the right machine); e_d makes every connection's keys fresh, so
 * a recorded session cannot be replayed to the daemon. Nonces are message
 * counters per direction, so a dropped, repeated or reordered message
 * breaks the channel instead of slipping through.
 *
 * The client is not authenticated by the handshake: inside the channel it
 * presents a paired device's token like any network caller, and the daemon
 * applies the same trust rules (src/server/trust.ts). Anyone holding the
 * pairing link still needs a pairing code or a token.
 */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const RELAY_PROTOCOL = 1;

/* ---------- encoding ---------- */

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const toBase64Url = (bytes: Uint8Array): string => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromBase64Url = (text: string): Uint8Array => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/* ---------- keys ---------- */

export interface KeyPair {
  privateKey: CryptoKey;
  /** The raw 32-byte public key. */
  publicKey: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)) };
}

/** A key pair as JSON (the private half as a JWK) — what the daemon keeps on disk. */
export async function exportKeyPair(pair: KeyPair): Promise<{ publicKey: string; privateKey: JsonWebKey }> {
  return { publicKey: toBase64Url(pair.publicKey), privateKey: await subtle().exportKey("jwk", pair.privateKey) };
}

export async function importKeyPair(saved: { publicKey: string; privateKey: JsonWebKey }): Promise<KeyPair> {
  const privateKey = await subtle().importKey("jwk", saved.privateKey, { name: "X25519" }, true, ["deriveBits"]);
  return { privateKey, publicKey: fromBase64Url(saved.publicKey) };
}

const importPublic = (raw: Uint8Array): Promise<CryptoKey> => {
  if (raw.length !== 32) throw new Error("invalid public key");
  return subtle().importKey("raw", raw as BufferSource, { name: "X25519" }, false, []);
};

/** X25519; WebCrypto refuses a low-order peer key (an all-zero secret). */
const dh = async (own: CryptoKey, peer: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await subtle().deriveBits({ name: "X25519", public: await importPublic(peer) }, own, 256));

/** How the relay knows a machine: the hash of its public key, so the pairing link alone finds it. */
export async function relayId(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", publicKey as BufferSource));
  return toBase64Url(digest.subarray(0, 16));
}

/* ---------- the channel ---------- */

/** One connection's two directions: seal what goes out, open what comes in, each in strict order. */
export interface Channel {
  seal(plaintext: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

async function channelKeys(ikm: Uint8Array, salt: Uint8Array): Promise<{ toDaemon: CryptoKey; toClient: CryptoKey }> {
  const base = await subtle().importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey"]);
  const derive = (info: string) =>
    subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: enc.encode(`kraftwerk-relay-v1 ${info}`) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { toDaemon: await derive("to-daemon"), toClient: await derive("to-client") };
}

const nonce = (n: number): Uint8Array => {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setBigUint64(4, BigInt(n));
  return iv;
};

function makeChannel(out: CryptoKey, inn: CryptoKey): Channel {
  let sent = 0;
  let received = 0;
  // Sealing is async: queue it so messages keep their counter order however callers interleave.
  let sealing: Promise<unknown> = Promise.resolve();
  let opening: Promise<unknown> = Promise.resolve();
  return {
    seal(plaintext) {
      const run = sealing.then(async () => {
        const iv = nonce(sent++);
        return toBase64(new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, out, enc.encode(plaintext))));
      });
      sealing = run.catch(() => {});
      return run;
    },
    open(sealed) {
      const run = opening.then(async () => {
        const iv = nonce(received++);
        try {
          return dec.decode(await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource }, inn, fromBase64(sealed) as BufferSource));
        } catch {
          throw new Error("relay message failed to decrypt — tampered, replayed or out of order");
        }
      });
      opening = run.catch(() => {});
      return run;
    },
  };
}

export interface Hello {
  t: "hello";
  v: number;
  key: string;
}

export interface Ready {
  t: "ready";
  key: string;
  box: string;
}

/** The client's side: a hello to send, and `finish` to check the daemon's ready and get the channel. */
export async function clientHandshake(daemonPublicKey: Uint8Array): Promise<{ hello: Hello; finish(ready: Ready): Promise<Channel> }> {
  const eph = await generateKeyPair();
  return {
    hello: { t: "hello", v: RELAY_PROTOCOL, key: toBase64(eph.publicKey) },
    async finish(ready) {
      if (ready?.t !== "ready" || typeof ready.key !== "string" || typeof ready.box !== "string") throw new Error("not a relay handshake answer");
      const daemonEph = fromBase64(ready.key);
      const ikm = concat(await dh(eph.privateKey, daemonPublicKey), await dh(eph.privateKey, daemonEph));
      const keys = await channelKeys(ikm, concat(eph.publicKey, daemonPublicKey, daemonEph));
      const channel = makeChannel(keys.toDaemon, keys.toClient);
      if ((await channel.open(ready.box).catch(() => "")) !== "ready") throw new Error("the machine did not prove its key — wrong pairing link, or not the machine you paired with");
      return channel;
    },
  };
}

/** The daemon's side: answer a client's hello with a ready, and get the channel. */
export async function daemonHandshake(own: KeyPair, hello: Hello): Promise<{ ready: Ready; channel: Channel }> {
  if (hello?.t !== "hello" || typeof hello.key !== "string") throw new Error("not a relay hello");
  if (hello.v !== RELAY_PROTOCOL) throw new Error(`relay protocol ${hello.v} is not supported (this kraftwerk speaks ${RELAY_PROTOCOL})`);
  const clientEph = fromBase64(hello.key);
  const eph = await generateKeyPair();
  const ikm = concat(await dh(own.privateKey, clientEph), await dh(eph.privateKey, clientEph));
  const keys = await channelKeys(ikm, concat(clientEph, own.publicKey, eph.publicKey));
  const channel = makeChannel(keys.toClient, keys.toDaemon);
  return { ready: { t: "ready", key: toBase64(eph.publicKey), box: await channel.seal("ready") }, channel };
}

/* ---------- the tunnel: HTTP over the channel ---------- */

/**
 * Inside the channel, the client sends requests and the daemon answers them
 * from its own server, streaming the body (event streams stay open):
 *
 *   → {t:"req", id, method, url, headers, body?}     body base64
 *   ← {t:"res", id, status, headers}
 *   ← {t:"data", id, chunk}                           base64, any number
 *   ← {t:"end", id} | {t:"fail", id, error}
 *   → {t:"abort", id}                                 the client stopped reading
 */
export type TunnelToDaemon =
  | { t: "req"; id: number; method: string; url: string; headers: Record<string, string>; body?: string }
  | { t: "abort"; id: number };

export type TunnelToClient =
  | { t: "res"; id: number; status: number; headers: Record<string, string> }
  | { t: "data"; id: number; chunk: string }
  | { t: "end"; id: number }
  | { t: "fail"; id: number; error: string };

/** The socket the client talks over — the browser's WebSocket and Node's global one both fit. */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: "close", fn: (ev: { code?: number; reason?: string }) => void): void;
  addEventListener(type: "open" | "error", fn: () => void): void;
  readonly readyState: number;
}

export interface Tunnel {
  /** `fetch` through the machine: paths are the daemon's (`/w/<slug>/api/…`); hand it to createClient({fetch}). */
  fetch: typeof fetch;
  close(): void;
  /** Resolves when the connection ends, with why. */
  readonly closed: Promise<string>;
}

export interface ConnectOptions {
  /** The relay's client endpoint, e.g. wss://srv.kraftwerk-cloud.netnode.cloud/api/relay/client */
  relayUrl: string;
  /** The machine's public key, from its pairing link. */
  publicKey: Uint8Array;
  /** Opens the socket (default: the global WebSocket). */
  connect?: (url: string) => RelaySocket;
  /** Abort the handshake after this long (default 15 s). */
  timeoutMs?: number;
}

const OPEN = 1;

/** Connect to a machine through the relay: the handshake, then a `fetch` that goes through it. */
export async function connectTunnel(opts: ConnectOptions): Promise<Tunnel> {
  const id = await relayId(opts.publicKey);
  const url = `${opts.relayUrl}${opts.relayUrl.includes("?") ? "&" : "?"}id=${encodeURIComponent(id)}`;
  const ws = opts.connect ? opts.connect(url) : (new WebSocket(url) as unknown as RelaySocket);
  const hs = await clientHandshake(opts.publicKey);

  let channel: Channel | null = null;
  let closedWhy = "";
  let resolveClosed!: (why: string) => void;
  const closed = new Promise<string>((r) => (resolveClosed = r));
  const pending = new Map<
    number,
    { resolve: (r: Response) => void; reject: (e: Error) => void; stream?: ReadableStreamDefaultController<Uint8Array>; signal?: AbortSignal }
  >();
  let nextId = 1;

  const finish = (why: string) => {
    if (closedWhy) return;
    closedWhy = why || "the connection closed";
    for (const p of pending.values()) {
      p.reject(new Error(closedWhy));
      try {
        p.stream?.error(new Error(closedWhy));
      } catch {}
    }
    pending.clear();
    resolveClosed(closedWhy);
  };

  const ready = new Promise<Channel>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("the machine did not answer through the relay"));
      ws.close();
    }, opts.timeoutMs ?? 15_000);
    ws.addEventListener("open", () => ws.send(JSON.stringify(hs.hello)));
    ws.addEventListener("close", (ev) => {
      clearTimeout(timer);
      const why = ev.reason || (ev.code === 4404 ? "the machine is not connected to the relay" : "the relay closed the connection");
      reject(new Error(why));
      finish(why);
    });
    ws.addEventListener("error", () => {});
    let first = true;
    // Messages are opened one after another (the channel counts them); a promise chain keeps the order.
    let queue: Promise<unknown> = Promise.resolve();
    ws.addEventListener("message", (ev) => {
      const text = typeof ev.data === "string" ? ev.data : dec.decode(ev.data as ArrayBuffer);
      queue = queue.then(async () => {
        if (first) {
          first = false;
          try {
            channel = await hs.finish(JSON.parse(text) as Ready);
            clearTimeout(timer);
            resolve(channel);
          } catch (err) {
            clearTimeout(timer);
            reject(err as Error);
            ws.close(4400, "handshake failed");
          }
          return;
        }
        if (!channel) return;
        let msg: TunnelToClient;
        try {
          msg = JSON.parse(await channel.open(text)) as TunnelToClient;
        } catch (err) {
          ws.close(4400, "bad message");
          finish((err as Error).message);
          return;
        }
        receive(msg);
      });
    });
  });

  const receive = (msg: TunnelToClient) => {
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.t === "res") {
      const body = new ReadableStream<Uint8Array>({
        start: (c) => {
          p.stream = c;
        },
        cancel: () => {
          pending.delete(msg.id);
          void send({ t: "abort", id: msg.id });
        },
      });
      const status = msg.status;
      // A Response cannot carry a body for these; the stream stays unused.
      const noBody = status === 204 || status === 304 || (status >= 100 && status < 200);
      p.resolve(new Response(noBody ? null : body, { status, headers: msg.headers }));
    } else if (msg.t === "data") {
      try {
        p.stream?.enqueue(fromBase64(msg.chunk));
      } catch {}
    } else if (msg.t === "end") {
      pending.delete(msg.id);
      try {
        p.stream?.close();
      } catch {}
    } else if (msg.t === "fail") {
      pending.delete(msg.id);
      const err = new Error(msg.error);
      p.reject(err);
      try {
        p.stream?.error(err);
      } catch {}
    }
  };

  const send = async (msg: TunnelToDaemon) => {
    if (!channel || ws.readyState !== OPEN) return;
    ws.send(await channel.seal(JSON.stringify(msg)));
  };

  await ready;

  const tunnelFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (closedWhy) throw new Error(closedWhy);
    const req = new Request(typeof input === "string" && input.startsWith("/") ? `http://relay${input}` : input, init);
    const u = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
    const id = nextId++;
    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject, signal: req.signal });
      req.signal?.addEventListener("abort", () => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        const err = new DOMException("aborted", "AbortError");
        p.reject(err);
        try {
          p.stream?.error(err);
        } catch {}
        void send({ t: "abort", id });
      });
      send({ t: "req", id, method: req.method, url: u.pathname + u.search, headers, ...(body?.length ? { body: toBase64(body) } : {}) }).catch((err: Error) => {
        pending.delete(id);
        reject(err);
      });
    });
  };

  return {
    fetch: tunnelFetch as typeof fetch,
    close: () => {
      ws.close(1000, "bye");
      finish("closed");
    },
    closed,
  };
}
