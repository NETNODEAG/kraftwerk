import { fingerprint, forgetMachine, listMachines, setCurrent, type Machine } from "./store";

/**
 * The remote page (/_kw/): pair this phone with a machine from a pairing
 * link (`kraftwerk remote pair`, or the QR code under Settings → Devices),
 * pick a paired machine, forget one. The link's fragment carries the
 * machine's key (k), a one-time code (c) and its name (n); a fragment never
 * reaches a server. Pairing itself runs in the service worker, which then
 * carries everything else.
 */

const app = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const KEY = /^[A-Za-z0-9_-]{43}$/;

async function worker(): Promise<ServiceWorker> {
  if (!("serviceWorker" in navigator)) throw new Error("this browser has no service workers (a private window?)");
  const reg = await navigator.serviceWorker.register("/_kw/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sw = reg.active ?? reg.waiting ?? reg.installing;
  if (!sw) throw new Error("the service worker did not start");
  return sw;
}

function pair(sw: ServiceWorker, msg: { key: string; code: string; name: string; label: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("no answer — is the machine awake and remote access on?")), 30_000);
    ch.port1.onmessage = (ev) => {
      clearTimeout(timer);
      const r = ev.data as { ok: boolean; error?: string };
      if (r.ok) resolve();
      else reject(new Error(r.error ?? "pairing failed"));
    };
    sw.postMessage({ type: "pair", ...msg }, [ch.port2]);
  });
}

async function showPair(key: string, code: string, label: string): Promise<void> {
  const fp = await fingerprint(key);
  const guess = /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android phone" : "browser";
  app.innerHTML = `
    <h1>Pair with ${esc(label)}</h1>
    <p class="dim">This phone reaches ${esc(label)} from anywhere, end to end encrypted: the relay in between cannot read along.</p>
    <div class="card">
      <p>Machine key <code>${esc(fp)}</code><br><span class="dim">The same as <code>kraftwerk remote</code> shows on the machine.</span></p>
      <label for="name">Name this device</label>
      <input id="name" value="${esc(guess)}" autocomplete="off" />
      <button id="go">Pair</button>
      <p id="msg" class="dim"></p>
    </div>`;
  const go = document.getElementById("go") as HTMLButtonElement;
  const msg = document.getElementById("msg")!;
  go.onclick = async () => {
    go.disabled = true;
    msg.className = "dim";
    msg.textContent = "Connecting…";
    try {
      const sw = await worker();
      await pair(sw, { key, code, label, name: (document.getElementById("name") as HTMLInputElement).value.trim() });
      // The link did its job; it must not linger in history with a used code.
      history.replaceState(null, "", "/_kw/");
      location.href = "/";
    } catch (err) {
      go.disabled = false;
      msg.className = "err";
      msg.textContent = (err as Error).message;
    }
  };
}

async function showList(note?: string): Promise<void> {
  const machines: Machine[] = await listMachines().catch(() => []);
  const rows = await Promise.all(
    machines.map(
      async (m) => `<div class="card machine"><a href="/" data-open="${esc(m.key)}">${esc(m.label)}<br><span class="dim">key <code>${esc(await fingerprint(m.key))}</code></span></a><button class="quiet" data-forget="${esc(m.key)}">Forget</button></div>`,
    ),
  );
  app.innerHTML = `
    <h1>kraftwerk remote</h1>
    ${note ? `<p class="err">${esc(note)}</p>` : ""}
    ${rows.join("") || `<div class="card"><p>No machine paired on this phone yet.</p><p class="dim">On the Mac: <code>kraftwerk remote on</code>, then <code>kraftwerk remote pair</code> — or scan the QR code under Settings → Devices — and open the link here.</p></div>`}`;
  app.querySelectorAll<HTMLAnchorElement>("[data-open]").forEach((a) => {
    a.onclick = async (ev) => {
      ev.preventDefault();
      await worker();
      await setCurrent(a.dataset.open!);
      location.href = "/";
    };
  });
  app.querySelectorAll<HTMLButtonElement>("[data-forget]").forEach((b) => {
    b.onclick = async () => {
      await forgetMachine(b.dataset.forget!);
      void showList();
    };
  });
  // A paired phone opens the list after a while: keep the worker installed (a browser may have dropped it).
  if (machines.length) void worker().catch(() => {});
}

const frag = new URLSearchParams(location.hash.slice(1));
const key = frag.get("k") ?? "";
const code = frag.get("c") ?? "";
if (KEY.test(key) && code) void showPair(key, code, frag.get("n") || "your machine");
else void showList(KEY.test(key) ? "This link has no pairing code — make a new one with `kraftwerk remote pair`." : undefined);
