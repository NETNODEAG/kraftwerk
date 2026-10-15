import { fingerprint, forgetJoined, forgetMachine, getJoined, listJoined, listMachines, pickHost, saveJoined, setCurrent, type Joined, type Machine } from "./store";

/**
 * The remote page (/_kw/): pair this phone with a machine from a pairing
 * link (`kraftwerk remote pair`, or the QR code under Settings → Devices),
 * pick a paired machine, forget one. The link's fragment carries the
 * machine's key (k), a one-time code (c) and its name (n); a fragment never
 * reaches a server. Pairing itself runs in the service worker, which then
 * carries everything else.
 *
 * And the workspaces this account joined, for a teammate with no clone:
 * sign in to the cloud (its API on this same origin), accept an invite,
 * see each workspace's hosts, open one — the service worker then tunnels to
 * a host as that workspace's member. Member tokens come with the invite or
 * are minted per workspace with the session, and are kept on the phone.
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

/** The cloud's API on this origin (the worker lets the remote page's own /api/ calls through). */
async function cloud<T>(p: string, body?: unknown): Promise<T> {
  const r = await fetch(p, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(data.error ?? `the cloud answered ${r.status}`), { status: r.status });
  return data;
}

interface Accepted {
  workspaceId: string;
  workspaceName: string;
  role: string;
  memberToken: string;
}
interface CloudWorkspace {
  id: string;
  name: string;
  role: string;
  hosts: Joined["hosts"];
}

/** A code, or a pasted /join/<code> link. */
const inviteCode = (raw: string): string => {
  const t = raw.trim();
  const m = /\/join\/([^/?#\s]+)/.exec(t);
  return decodeURIComponent(m ? m[1] : t);
};

/** Merge the cloud's list into what the phone keeps: names, roles and hosts are the cloud's, tokens stay ours. */
async function syncJoined(list: CloudWorkspace[]): Promise<void> {
  for (const w of list) {
    const had = await getJoined(w.id).catch(() => undefined);
    await saveJoined({ ...(had ?? { joinedAt: new Date().toISOString() }), workspaceId: w.id, name: w.name, role: w.role, hosts: w.hosts }).catch(() => {});
  }
}

/** A fresh member token for a workspace this account is on (the session's), kept for it. */
async function mint(id: string): Promise<Joined> {
  const r = await cloud<Accepted>(`/api/me/workspaces/${encodeURIComponent(id)}/token`, {});
  const had = await getJoined(id);
  const j: Joined = { ...(had ?? { hosts: [], joinedAt: new Date().toISOString() }), workspaceId: id, name: r.workspaceName, role: r.role, token: r.memberToken, error: undefined };
  await saveJoined(j);
  return j;
}

function openMember(sw: ServiceWorker, workspaceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("no answer — is the host awake and remote access on?")), 30_000);
    ch.port1.onmessage = (ev) => {
      clearTimeout(timer);
      const r = ev.data as { ok: boolean; slug?: string; error?: string };
      if (r.ok && r.slug) resolve(r.slug);
      else reject(new Error(r.error ?? "the host did not let this member in"));
    };
    sw.postMessage({ type: "member", workspaceId }, [ch.port2]);
  });
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
    ${rows.join("") || `<div class="card"><p>No machine paired on this phone yet.</p><p class="dim">On the Mac: <code>kraftwerk remote on</code>, then <code>kraftwerk remote pair</code> — or scan the QR code under Settings → Devices — and open the link here.</p></div>`}
    <h2>Workspaces you joined</h2>
    <div id="joined"><p class="dim">Loading…</p></div>`;
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
  void showJoined();
}

/** The joined workspaces: the phone's own list, refreshed from the cloud while signed in; sign-in and invites. */
async function showJoined(note?: string, good = false): Promise<void> {
  const box = document.getElementById("joined");
  if (!box) return;
  const me = await cloud<{ user: { email: string } | null }>("/api/auth/me").catch(() => ({ user: null }));
  const signedIn = !!me.user;
  let cloudNote = "";
  if (signedIn) {
    await cloud<{ workspaces: CloudWorkspace[] }>("/api/me/workspaces").then((r) => syncJoined(r.workspaces), (err: Error) => (cloudNote = err.message));
  }
  const joined = (await listJoined().catch(() => [] as Joined[])).sort((a, b) => a.name.localeCompare(b.name));
  const rows = joined.map((j) => {
    const host = pickHost(j);
    const where = host ? `${esc(host.machineName)} · ${host.online ? "online" : "offline"}` : "no host in the cloud";
    const fix = j.error
      ? `<p class="err">${esc(j.error)}</p>${signedIn ? `<button class="quiet" data-mint="${esc(j.workspaceId)}">Get a new token and open</button>` : `<p class="dim">Sign in below for a new token.</p>`}`
      : "";
    return `<div class="card"><div class="machine"><a href="/" data-ws="${esc(j.workspaceId)}">${esc(j.name)}<br><span class="dim">${where} · ${esc(j.role)}</span></a><button class="quiet" data-unjoin="${esc(j.workspaceId)}">Forget</button></div>${fix}</div>`;
  });
  box.innerHTML = `
    ${note ? `<p class="${good ? "dim" : "err"}">${esc(note)}</p>` : ""}
    ${cloudNote ? `<p class="err">${esc(cloudNote)}</p>` : ""}
    ${rows.join("") || `<div class="card"><p>No workspace joined on this phone yet.</p><p class="dim">A teammate invites you from the workspace's Members settings; accept the invite here.</p></div>`}
    <div class="card">
      ${
        signedIn
          ? `<p>Signed in as <strong>${esc(me.user!.email)}</strong> <button class="quiet" id="logout">Sign out</button></p>`
          : `<p class="dim">Sign in to the kraftwerk cloud to join and open workspaces.</p>
             <label for="email">Email</label><input id="email" type="email" autocomplete="username" />
             <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" />`
      }
      <label for="invite">Invite code or link${signedIn ? "" : " (optional)"}</label>
      <input id="invite" autocomplete="off" placeholder="XKQ7-2MPD-HH3A" />
      ${signedIn ? `<button id="join">Join</button>` : `<button id="login">Sign in</button><button class="quiet" id="signup">Create an account instead</button>`}
      <p id="cloudmsg" class="dim"></p>
    </div>`;

  const msg = document.getElementById("cloudmsg")!;
  const fail = (err: unknown) => {
    msg.className = "err";
    msg.textContent = (err as Error).message;
  };
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

  /** Accept the invite in the field, if any: the workspace and its token land on the phone. */
  const acceptInvite = async (): Promise<Accepted | undefined> => {
    const code = inviteCode(val("invite"));
    if (!code) return undefined;
    const r = await cloud<Accepted>("/api/invites/accept", { code });
    const had = await getJoined(r.workspaceId);
    await saveJoined({ ...(had ?? { hosts: [], joinedAt: new Date().toISOString() }), workspaceId: r.workspaceId, name: r.workspaceName, role: r.role, token: r.memberToken, error: undefined });
    return r;
  };

  const auth = (kind: "login" | "signup") => async () => {
    msg.className = "dim";
    msg.textContent = kind === "signup" ? "Creating the account…" : "Signing in…";
    try {
      await cloud(`/api/auth/${kind}`, { email: val("email"), password: (document.getElementById("password") as HTMLInputElement).value });
      let accepted: Accepted | undefined;
      try {
        accepted = await acceptInvite();
      } catch (err) {
        return void showJoined(`Signed in, but the invite did not go through: ${(err as Error).message}`);
      }
      void showJoined(accepted ? `Joined ${accepted.workspaceName}.` : undefined, true);
    } catch (err) {
      fail(err);
    }
  };
  const login = document.getElementById("login");
  if (login) login.onclick = auth("login");
  const signup = document.getElementById("signup");
  if (signup) signup.onclick = auth("signup");
  const logout = document.getElementById("logout");
  if (logout) logout.onclick = () => void cloud("/api/auth/logout", {}).then(() => showJoined(), fail);
  const join = document.getElementById("join");
  if (join)
    join.onclick = async () => {
      msg.className = "dim";
      msg.textContent = "Joining…";
      try {
        const r = await acceptInvite();
        if (!r) throw new Error("paste an invite code or a /join/ link first");
        void showJoined(`Joined ${r.workspaceName}.`, true);
      } catch (err) {
        fail(err);
      }
    };

  const open = async (id: string, fresh: boolean) => {
    msg.className = "dim";
    msg.textContent = "Connecting…";
    try {
      let j = await getJoined(id);
      if (fresh || !j?.token) {
        if (!signedIn) throw new Error("sign in first — this phone has no member token for that workspace");
        j = await mint(id);
      }
      const sw = await worker();
      const slug = await openMember(sw, id);
      location.href = `/w/${encodeURIComponent(slug)}/`;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) return void showJoined("Your sign-in ran out — sign in again.");
      // The host's refusal is on the row now (the worker kept it, with the way out); anything else goes on top.
      const kept = await getJoined(id).catch(() => undefined);
      void showJoined(kept?.error === (err as Error).message ? undefined : (err as Error).message);
    }
  };
  box.querySelectorAll<HTMLAnchorElement>("[data-ws]").forEach((a) => {
    a.onclick = (ev) => {
      ev.preventDefault();
      void open(a.dataset.ws!, false);
    };
  });
  box.querySelectorAll<HTMLButtonElement>("[data-mint]").forEach((b) => (b.onclick = () => void open(b.dataset.mint!, true)));
  box.querySelectorAll<HTMLButtonElement>("[data-unjoin]").forEach((b) => {
    b.onclick = async () => {
      await forgetJoined(b.dataset.unjoin!).catch(() => {});
      void showJoined();
    };
  });
}

const frag = new URLSearchParams(location.hash.slice(1));
const key = frag.get("k") ?? "";
const code = frag.get("c") ?? "";
if (KEY.test(key) && code) void showPair(key, code, frag.get("n") || "your machine");
else void showList(KEY.test(key) ? "This link has no pairing code — make a new one with `kraftwerk remote pair`." : undefined);
