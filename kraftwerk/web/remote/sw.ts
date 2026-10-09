import { connectTunnel, fromBase64Url, type Tunnel } from "../../src/client/relay";
import { currentMachine, relayUrl, saveMachine, setCurrent, type Machine } from "./store";

/**
 * The remote page's service worker: every request this origin makes — the
 * kraftwerk web UI, its API calls, its event streams, previews and
 * downloads — goes through the encrypted tunnel to the machine that is open,
 * with this device's token attached. The UI runs unchanged: as far as it
 * knows, it is served by the daemon at `/`, `/w/<slug>/`.
 *
 * Only /_kw/ (this page, this worker) comes from the server itself. The UI's
 * own socket (/api/ws) cannot pass a service worker; the UI falls back to
 * polling and event streams, which do.
 *
 * Cross-site requests never reach a service worker except as navigations, so
 * a navigation that is not a GET (a form posted from some other site) is
 * refused: the token must only ride on this page's own requests.
 */

interface FetchEventLike extends Event {
  request: Request;
  respondWith(r: Promise<Response> | Response): void;
}
interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface MessageEventLike extends Event {
  data: unknown;
  ports: MessagePort[];
}
const sw = self as unknown as {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", fn: (ev: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", fn: (ev: FetchEventLike) => void): void;
  addEventListener(type: "message", fn: (ev: MessageEventLike) => void): void;
};

sw.addEventListener("install", (ev) => ev.waitUntil(sw.skipWaiting()));
sw.addEventListener("activate", (ev) => ev.waitUntil(sw.clients.claim()));

/** The open tunnel, per machine key; a closed one is dropped and the next request reconnects. */
let tunnel: { key: string; t: Promise<Tunnel> } | null = null;

function tunnelTo(key: string): Promise<Tunnel> {
  if (tunnel?.key === key) return tunnel.t;
  const prev = tunnel;
  void prev?.t.then((t) => t.close()).catch(() => {});
  const t = connectTunnel({ relayUrl: relayUrl(sw.location.origin), publicKey: fromBase64Url(key) });
  const entry = { key, t };
  tunnel = entry;
  t.then(
    (open) => void open.closed.then(() => tunnel === entry && (tunnel = null)),
    () => tunnel === entry && (tunnel = null),
  );
  return t;
}

const page = (status: number, title: string, text: string): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font:16px system-ui;padding:24px;max-width:36em;margin:auto"><h1 style="font-size:20px">${title}</h1><p>${text}</p>` +
      `<p><a href="/_kw/">Machines</a> · <a href="" onclick="location.reload();return false">Try again</a></p>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

async function through(req: Request, machine: Machine): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${machine.token}`);
  headers.set("host", url.host);
  const t = await tunnelTo(machine.key);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  const res = await t.fetch(url.pathname + url.search, { method: req.method, headers, body, signal: req.signal });
  // The UI's own pairing screen (shown once the machine revoked this device) pairs through here too: the
  // machine answers with a token (and a cookie, which a worker cannot keep) — keep the token for this machine.
  if (req.method === "POST" && /^(\/w\/[^/]+)?\/api\/pair$/.test(url.pathname) && res.ok) {
    const { token } = (await res.clone().json().catch(() => ({}))) as { token?: string };
    if (token) await saveMachine({ ...machine, token, pairedAt: new Date().toISOString() });
  }
  return res;
}

sw.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== sw.location.origin || url.pathname.startsWith("/_kw/")) return;
  ev.respondWith(
    (async () => {
      if (ev.request.mode === "navigate" && ev.request.method !== "GET") return page(403, "Refused", "A form from another page tried to act on your machine.");
      const machine = await currentMachine();
      if (!machine) return ev.request.mode === "navigate" ? Response.redirect("/_kw/", 302) : new Response(JSON.stringify({ error: "no machine paired here" }), { status: 503 });
      try {
        return await through(ev.request, machine);
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        const why = (err as Error).message;
        if (ev.request.mode === "navigate") return page(502, `${machine.label} is not reachable`, `${why}. Is the Mac awake, and is remote access on (<code>kraftwerk remote</code>)?`);
        return new Response(JSON.stringify({ error: why }), { status: 502, headers: { "content-type": "application/json" } });
      }
    })(),
  );
});

/** The page asks: pair with a machine (its key, a code, a name for this device). */
sw.addEventListener("message", (ev) => {
  const msg = ev.data as { type?: string; key?: string; code?: string; name?: string; label?: string };
  const port = ev.ports[0];
  if (msg?.type !== "pair" || !msg.key || !msg.code || !port) return;
  const key = msg.key;
  void (async () => {
    try {
      tunnel = null;
      const t = await tunnelTo(key);
      const r = await t.fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: msg.code, name: msg.name || "phone" }),
      });
      const body = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!r.ok || !body.token) throw new Error(body.error ?? `pairing failed (${r.status})`);
      await saveMachine({ key, token: body.token, label: msg.label || "your machine", pairedAt: new Date().toISOString() });
      await setCurrent(key);
      port.postMessage({ ok: true });
    } catch (err) {
      port.postMessage({ ok: false, error: (err as Error).message });
    }
  })();
});
