import { connectTunnel, fromBase64Url, type Tunnel } from "../../src/client/relay";
import { currentTarget, getJoined, pickHost, relayUrl, saveJoined, saveMachine, setCurrent, setCurrentJoined, type Joined, type Machine } from "./store";

/**
 * The remote page's service worker: every request this origin makes — the
 * kraftwerk web UI, its API calls, its event streams, previews and
 * downloads — goes through the encrypted tunnel to the machine that is open,
 * with this device's token attached. The UI runs unchanged: as far as it
 * knows, it is served by the daemon at `/`, `/w/<slug>/`.
 *
 * Or a joined workspace is open: the tunnel goes to one of its hosts and
 * opens as that workspace's remote member (the member token in the sealed
 * hello, src/client/relay.ts); the channel is then scoped to /w/<slug>/ and
 * no device token rides along.
 *
 * The remote page's own calls to /api/ (sign-in, invites, joined
 * workspaces) are the cloud's, on this origin: they pass to the network.
 * Every other client's /api/ is the machine's.
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
  clientId: string;
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
  clients: { claim(): Promise<void>; get(id: string): Promise<{ url: string } | undefined> };
  addEventListener(type: "install" | "activate", fn: (ev: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", fn: (ev: FetchEventLike) => void): void;
  addEventListener(type: "message", fn: (ev: MessageEventLike) => void): void;
};

sw.addEventListener("install", (ev) => ev.waitUntil(sw.skipWaiting()));
sw.addEventListener("activate", (ev) => ev.waitUntil(sw.clients.claim()));

/** The open tunnel, per machine key (and member session); a closed one is dropped and the next request reconnects. */
let tunnel: { key: string; t: Promise<Tunnel> } | null = null;

function tunnelTo(key: string, member?: { token: string; workspaceId: string }): Promise<Tunnel> {
  const id = member ? `${key} ${member.workspaceId} ${member.token}` : key;
  if (tunnel?.key === id) return tunnel.t;
  const prev = tunnel;
  void prev?.t.then((t) => t.close()).catch(() => {});
  const t = connectTunnel({ relayUrl: relayUrl(sw.location.origin), publicKey: fromBase64Url(key), ...(member ? { member } : {}) });
  const entry = { key: id, t };
  tunnel = entry;
  t.then(
    (open) => void open.closed.then(() => tunnel === entry && (tunnel = null)),
    () => tunnel === entry && (tunnel = null),
  );
  return t;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/** A joined workspace's host, as that workspace's member: the hello first, then the requests (no device token). */
async function memberTunnel(j: Joined): Promise<Tunnel> {
  const host = pickHost(j);
  if (!host) throw new Error(`no machine hosts ${j.name} in the cloud right now`);
  if (!j.token) throw new Error("no member token for this workspace on this phone — sign in again");
  try {
    const t = await tunnelTo(host.publicKey, { token: j.token, workspaceId: j.workspaceId });
    const slug = t.member?.workspace.slug;
    if ((slug && slug !== j.slug) || j.hostKey !== host.publicKey || j.error) await saveJoined({ ...j, slug: slug ?? j.slug, hostKey: host.publicKey, error: undefined });
    return t;
  } catch (err) {
    // Kept for the list (/_kw/), which offers a new token or a sign-in from there.
    await saveJoined({ ...j, error: (err as Error).message }).catch(() => {});
    throw err;
  }
}

async function throughMember(req: Request, j: Joined): Promise<Response> {
  const url = new URL(req.url);
  const t = await memberTunnel(j);
  const slug = t.member?.workspace.slug ?? j.slug;
  // The machine's root is not the member's: their workspace is.
  if (req.mode === "navigate" && url.pathname === "/" && slug) return Response.redirect(`/w/${encodeURIComponent(slug)}/`, 302);
  // The daemon answers a member session inside /w/<slug>/ only; the UI's shell asks for its files at the root
  // (/assets/…, the icons) — the same files are there under the workspace's prefix. /api/ stays as asked: a
  // machine-wide call is refused, as it should be.
  const p = slug && !url.pathname.startsWith("/w/") && !url.pathname.startsWith("/api/") ? `/w/${encodeURIComponent(slug)}${url.pathname}` : url.pathname;
  const headers = new Headers(req.headers);
  headers.delete("authorization");
  headers.set("host", url.host);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  return t.fetch(p + url.search, { method: req.method, headers, body, signal: req.signal });
}

/** Whether a request comes from the remote page itself (/_kw/) — its /api/ calls are the cloud's, not the machine's. */
async function fromRemotePage(ev: FetchEventLike): Promise<boolean> {
  if (!ev.clientId) return false;
  const client = await sw.clients.get(ev.clientId).catch(() => undefined);
  return !!client && new URL(client.url).pathname.startsWith("/_kw/");
}

sw.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== sw.location.origin || url.pathname.startsWith("/_kw/")) return;
  ev.respondWith(
    (async () => {
      if (url.pathname.startsWith("/api/") && (await fromRemotePage(ev))) return fetch(ev.request);
      if (ev.request.mode === "navigate" && ev.request.method !== "GET") return page(403, "Refused", "A form from another page tried to act on your machine.");
      const target = await currentTarget();
      if (!target) return ev.request.mode === "navigate" ? Response.redirect("/_kw/", 302) : new Response(JSON.stringify({ error: "no machine paired here" }), { status: 503 });
      try {
        return "joined" in target ? await throughMember(ev.request, target.joined) : await through(ev.request, target.machine);
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        const why = (err as Error).message;
        if (ev.request.mode === "navigate") {
          if ("joined" in target) return page(502, `${esc(target.joined.name)} did not open`, `${esc(why)}.`);
          return page(502, `${target.machine.label} is not reachable`, `${why}. Is the Mac awake, and is remote access on (<code>kraftwerk remote</code>)?`);
        }
        return new Response(JSON.stringify({ error: why }), { status: 502, headers: { "content-type": "application/json" } });
      }
    })(),
  );
});

/**
 * The page asks: open a joined workspace — a fresh tunnel to its host, the member's hello, and the slug to go to
 * (or the host's refusal, word for word).
 */
function openJoined(workspaceId: string, port: MessagePort): void {
  void (async () => {
    try {
      const j = await getJoined(workspaceId);
      if (!j) throw new Error("this workspace is not on this phone");
      tunnel = null;
      const t = await memberTunnel(j);
      await setCurrentJoined(workspaceId);
      port.postMessage({ ok: true, slug: t.member?.workspace.slug ?? j.slug });
    } catch (err) {
      port.postMessage({ ok: false, error: (err as Error).message });
    }
  })();
}

/** The page asks: pair with a machine (its key, a code, a name for this device) — or open a joined workspace. */
sw.addEventListener("message", (ev) => {
  const msg = ev.data as { type?: string; key?: string; code?: string; name?: string; label?: string; workspaceId?: string };
  const port = ev.ports[0];
  if (msg?.type === "member" && msg.workspaceId && port) return openJoined(msg.workspaceId, port);
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
