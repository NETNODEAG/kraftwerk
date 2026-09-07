import { useCallback, useEffect, useRef, useState } from "react";
import { Lamp, Link, fmtAgo, Icon, navigate, useExpertMode } from "./shared";
import type { ChatAgentId, ChatMeta, VibeableInfo, VibeablesView, VibeableStatus } from "./types";

/**
 * Vibeable: an app folder rendered live next to a chat. The picker opens one
 * (or creates a new one with the starter) on the chat; the pane embeds it
 * — the folder served by the inspector, or the app's own dev server once it
 * runs — and reloads on the file-change events the server streams while
 * the agent edits.
 */

async function setVibeable(chatId: string, slug: string | null): Promise<ChatMeta> {
  const r = await fetch(`/api/chats/${chatId}/vibeable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  const d = (await r.json()) as ChatMeta & { error?: string };
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/* ---------- picker ---------- */

export function VibePicker({
  chatId,
  onClose,
  onOpened,
}: {
  chatId: string;
  onClose: () => void;
  onOpened: (meta: ChatMeta) => void;
}) {
  const [view, setView] = useState<VibeablesView | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/vibeables", { cache: "no-store" })
      .then((r) => r.json())
      .then((v: VibeablesView) => alive && setView(v))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = async (slug: string) => {
    setBusy(slug);
    setError("");
    try {
      onOpened(await setVibeable(chatId, slug));
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy("new");
    setError("");
    try {
      const r = await fetch("/api/vibeables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const d = (await r.json()) as VibeableInfo & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onOpened(await setVibeable(chatId, d.slug));
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  const apps = view?.vibeables ?? [];
  return (
    <div className="vibeable-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vibeable-picker" role="dialog" aria-label="Open a vibeable">
        <div className="vibeable-picker-head">
          <Icon name="web" />
          <h2>Open a vibeable</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="vibeable-picker-hint">
          A small app built live in this chat: the agent works inside its folder, and every saved file shows up in the preview pane.
        </p>
        {view && !view.enabled && (
          <div className="vibeable-picker-off">
            Vibeables are off. Turn them on in <a href="#/settings">settings</a> first.
          </div>
        )}
        {view?.enabled && (
          <>
            <form className="vibeable-new" onSubmit={(e) => void create(e)}>
              <input
                value={name}
                placeholder="new vibeable, e.g. team-dashboard"
                aria-label="new vibeable name"
                onChange={(e) => setName(e.target.value)}
                autoFocus
                disabled={!!busy}
              />
              <button className="ws-btn primary" type="submit" disabled={!!busy || !name.trim()}>
                <Icon name={busy === "new" ? "progress_activity" : "add"} className="ms-sm" />
                {busy === "new" ? "creating…" : "create"}
              </button>
            </form>
            <div className="vibeable-picker-list">
              {apps.length === 0 && <div className="vibeable-picker-empty">No vibeables yet — create one above.</div>}
              {apps.map((a) => (
                <button key={a.slug} className="vibeable-repo" disabled={!!busy} onClick={() => void open(a.slug)}>
                  <span className="vibeable-repo-icon">
                    <Icon name={busy === a.slug ? "progress_activity" : a.dev ? "terminal" : "web"} />
                  </span>
                  <span className="vibeable-repo-main">
                    <span className="vibeable-repo-name">{a.slug}</span>
                    <span className="vibeable-repo-sub">
                      {a.configError ? a.configError : a.dev ? `dev: ${a.dev}` : a.hasIndex ? "static" : "no index.html yet"}
                      {a.updatedAt ? ` · ${fmtAgo(a.updatedAt)}` : ""}
                    </span>
                  </span>
                  <Icon name="chevron_right" className="vibeable-repo-go" />
                </button>
              ))}
            </div>
          </>
        )}
        {error && <div className="settings-err vibeable-picker-err">{error}</div>}
      </div>
    </div>
  );
}

/* ---------- pane ---------- */

export function VibePane({
  chatId,
  slug,
  agentBusy,
  onClosed,
}: {
  /** The chat the app is attached to; absent on the vibeables screen, where the pane is a plain preview. */
  chatId?: string;
  slug: string;
  /** A turn is running: closing would move the agent mid-work, so the server refuses it. */
  agentBusy?: boolean;
  onClosed?: (meta: ChatMeta) => void;
}) {
  const [status, setStatus] = useState<VibeableStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showLog, setShowLog] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/vibeables/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const d = (await r.json()) as VibeableStatus & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setStatus(d);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const es = new EventSource(`/api/vibeables/${encodeURIComponent(slug)}/events`);
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as
        | { type: "change"; files: string[] }
        | { type: "dev"; dev: VibeableStatus["dev"] }
        | { type: "error"; message: string };
      if (ev.type === "change") {
        setTick((t) => t + 1);
        setFlash(ev.files.slice(0, 3).join(", ") + (ev.files.length > 3 ? ` +${ev.files.length - 3}` : ""));
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setFlash(""), 2_500);
      } else if (ev.type === "dev" && ev.dev) {
        const dev = ev.dev;
        setStatus((s) => (s ? { ...s, dev, mode: dev.running ? "dev" : "static" } : s));
      } else if (ev.type === "error") {
        setError(ev.message);
      }
    };
    return () => {
      es.close();
      clearTimeout(flashTimer);
    };
  }, [slug, load]);

  // The log grows while the dev server runs; dev events only mark state changes.
  const devRunning = !!status?.dev?.running;
  useEffect(() => {
    if (!devRunning || !showLog) return;
    const t = setInterval(() => void load(), 2_000);
    return () => clearInterval(t);
  }, [devRunning, showLog, load]);

  // Both modes go through the inspector's own origin: static files served
  // directly, a running dev server proxied under the same prefix. That is
  // what a container or reverse proxy exposes; a random host port is not.
  const src = status ? `${status.url}?v=${tick}` : "";

  const reload = () => setTick((t) => t + 1);

  const dev = async (verb: "start" | "stop") => {
    setBusy(verb);
    setError("");
    try {
      const r = await fetch(`/api/vibeables/${encodeURIComponent(slug)}/dev/${verb}`, { method: "POST" });
      const d = (await r.json()) as VibeableStatus & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setStatus(d);
      if (verb === "start") setShowLog(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const close = async () => {
    if (!chatId || !onClosed) return;
    setBusy("close");
    setError("");
    try {
      onClosed(await setVibeable(chatId, null));
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  const d = status?.dev;
  const modeChip = d?.running
    ? d.ready
      ? { cls: "ok", text: `dev :${d.port}` }
      : { cls: "running", text: "starting…" }
    : d && d.exitCode !== undefined
      ? { cls: "failed", text: `dev exited${d.exitCode == null ? "" : ` (${d.exitCode})`}` }
      : { cls: "ok", text: "static" };

  return (
    <aside className="vibeable-pane" data-vibe={slug}>
      <div className="vibeable-bar">
        <Icon name="web" className="vibeable-bar-icon" />
        <span className="vibeable-name" title={status?.path}>{slug}</span>
        <span className={`vibeable-mode ${modeChip.cls}`} title={d?.command ? `dev: ${d.command}` : status?.dir}>
          <span className={`lamp ${modeChip.cls}`} />
          {modeChip.text}
        </span>
        {flash && <span className="vibeable-flash" title={flash}><Icon name="bolt" className="ms-sm" /> reloaded</span>}
        <span className="spacer" />
        {status?.config.dev &&
          (d?.running ? (
            <button className="icon-btn" onClick={() => void dev("stop")} disabled={!!busy} title={`Stop the dev server (${status.config.dev})`} aria-label="stop dev server">
              <Icon name={busy === "stop" ? "progress_activity" : "stop"} />
            </button>
          ) : (
            <button className="icon-btn vibeable-play" onClick={() => void dev("start")} disabled={!!busy} title={`Start the dev server: ${status.config.dev}`} aria-label="start dev server">
              <Icon name={busy === "start" ? "progress_activity" : "play_arrow"} />
            </button>
          ))}
        {d && (
          <button className={`icon-btn${showLog ? " active" : ""}`} onClick={() => setShowLog((v) => !v)} title="Dev server output" aria-label="dev server output">
            <Icon name="terminal" />
          </button>
        )}
        <button className="icon-btn" onClick={reload} title="Reload the preview" aria-label="reload preview">
          <Icon name="refresh" />
        </button>
        <button
          className="icon-btn"
          onClick={() => window.open(status?.url ?? "", "_blank", "noopener")}
          disabled={!status}
          title="Open in a new tab"
          aria-label="open in new tab"
        >
          <Icon name="open_in_new" />
        </button>
        {chatId && onClosed && (
          <button
            className="icon-btn"
            onClick={() => void close()}
            disabled={!!busy || agentBusy}
            title={agentBusy ? "The agent is working — close the preview when the turn is done" : "Close the preview (the agent returns to the project root)"}
            aria-label="close preview"
          >
            <Icon name={busy === "close" ? "progress_activity" : "close"} />
          </button>
        )}
      </div>
      {(error || status?.configError) && (
        <div className="vibeable-err">
          <span>{error || status?.configError}</span>
          {error && (
            <button className="vibeable-err-x" onClick={() => setError("")} aria-label="dismiss">
              <Icon name="close" className="ms-sm" />
            </button>
          )}
        </div>
      )}
      {status?.config.dev && !d?.running && !error && (
        <div className="vibeable-note">
          This app has a dev command (<code>{status.config.dev}</code>). Showing the static folder until you start it.
        </div>
      )}
      {src && (
        <iframe
          ref={frame}
          className="vibeable-frame"
          src={src}
          title={`vibeable ${slug}`}
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          allow="clipboard-write"
        />
      )}
      {!src && !error && <div className="empty">loading…</div>}
      {showLog && d && (
        <pre className="vibeable-log" aria-label="dev server log">
          {d.log.length ? d.log.join("\n") : "(no output yet)"}
        </pre>
      )}
    </aside>
  );
}

/** Shown in place of the pane when the feature was switched off while a chat still had an app open. */
export function VibeOffNote({ chatId, slug, onClosed }: { chatId: string; slug: string; onClosed: (meta: ChatMeta) => void }) {
  const [error, setError] = useState("");
  return (
    <aside className="vibeable-pane vibeable-pane-off" data-vibe={slug}>
      <div className="vibeable-bar">
        <Icon name="web" className="vibeable-bar-icon" />
        <span className="vibeable-name">{slug}</span>
        <span className="vibeable-mode failed"><span className="lamp failed" />vibeables are off</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => setVibeable(chatId, null).then(onClosed).catch((e: Error) => setError(e.message))} title="Detach the app from this chat" aria-label="close preview">
          <Icon name="close" />
        </button>
      </div>
      <div className="vibeable-note">
        This chat has <b>{slug}</b> open, but vibeables were switched off in <a href="#/settings">settings</a>. Turn them back on to see the preview, or detach the app.
      </div>
      {error && <div className="vibeable-err"><span>{error}</span></div>}
    </aside>
  );
}

/* ---------- screen ---------- */

const AGENT_KEY = "kw-vibeable-agent";

/** Start a chat on the given harness with the app open in its pane, and go there. */
async function openInChat(slug: string, agent: ChatAgentId): Promise<void> {
  const r = await fetch("/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, scope: { kind: "general" } }),
  });
  const chat = (await r.json()) as ChatMeta & { error?: string };
  if (!r.ok || !chat.id) throw new Error(chat.error || `HTTP ${r.status}`);
  await setVibeable(chat.id, slug);
  navigate(`/agents/chats/${chat.id}`);
}

/**
 * Vibeables (#/vibeables): a sidebar with every app under the root, newest
 * change first, with a search box; the selected app renders in a preview
 * pane on the right. #/vibeables lands on the latest app, #/vibeables/new
 * is the create form (also the whole screen while there are no apps).
 * Shown only when kraftwerk.yml turns the feature on.
 */
export function VibeablesScreen({ slug }: { slug?: string }) {
  const [view, setView] = useState<VibeablesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [agent, setAgent] = useState<ChatAgentId>(() => {
    try {
      const v = localStorage.getItem(AGENT_KEY);
      return v === "codex" || v === "pi" ? v : "claude";
    } catch {
      return "claude";
    }
  });
  const expert = useExpertMode();

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/vibeables", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView((await r.json()) as VibeablesView);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "could not load vibeables");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await reload();
      if (alive) timer = setTimeout(tick, 15_000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reload]);

  // Newest change first; the API lists alphabetically.
  const apps = [...(view?.vibeables ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? apps.filter((a) => a.slug.toLowerCase().includes(needle)) : apps;
  const creating = slug === "new";
  const current = slug && !creating ? apps.find((a) => a.slug === slug) : undefined;

  // Route changes refetch, so a row removed elsewhere does not linger for a poll interval.
  useEffect(() => {
    void reload();
  }, [slug, reload]);

  // A bare #/vibeables lands on the app changed last.
  const latest = apps[0]?.slug;
  useEffect(() => {
    if (!slug && latest) navigate(`/vibeables/${encodeURIComponent(latest)}`, { replace: true });
  }, [slug, latest]);

  const mark = (key: string, verb: string) => setBusy((b) => ({ ...b, [key]: verb }));
  const unmark = (key: string) =>
    setBusy((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  const fail = (key: string, err: unknown) => setErrors((e) => ({ ...e, [key]: (err as Error).message }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy.__new) return;
    mark("__new", "create");
    setErrors((x) => ({ ...x, __new: "" }));
    try {
      const r = await fetch("/api/vibeables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const d = (await r.json()) as VibeableInfo & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setName("");
      await reload();
      navigate(`/vibeables/${encodeURIComponent(d.slug ?? n)}`);
    } catch (err) {
      fail("__new", err);
    } finally {
      unmark("__new");
    }
  };

  const open = async (target: string) => {
    mark(target, "open");
    try {
      await openInChat(target, agent);
    } catch (err) {
      fail(target, err);
      unmark(target);
    }
  };

  const remove = async (target: string) => {
    mark(target, "remove");
    setConfirmRemove(false);
    try {
      const r = await fetch(`/api/vibeables/${encodeURIComponent(target)}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      await reload();
      navigate("/vibeables", { replace: true });
    } catch (err) {
      fail(target, err);
      void reload();
    } finally {
      unmark(target);
    }
  };

  const pickAgent = (a: ChatAgentId) => {
    setAgent(a);
    try {
      localStorage.setItem(AGENT_KEY, a);
    } catch {}
  };

  const stateOf = (a: VibeableInfo) =>
    a.configError
      ? { label: "config error", cls: "failed" }
      : a.hasIndex
        ? { label: a.dev ? "dev" : "static", cls: "ok" }
        : { label: "no index.html yet", cls: "pending" };

  let main: React.ReactNode;
  if (view && !view.enabled)
    main = (
      <div className="empty">
        {view.error && !/are off/.test(view.error) ? (
          <span className="settings-err">{view.error}</span>
        ) : (
          <>
            Vibeables are off. Turn them on in <a href="#/settings">settings</a> or add a <code>vibeables:</code> block to kraftwerk.yml.
          </>
        )}
      </div>
    );
  else if (!view) main = <div className="empty">loading…</div>;
  else if (creating || apps.length === 0)
    main = (
      <form className="empty empty-action" onSubmit={(e) => void create(e)}>
        <div className="know-newbundle">
          <input value={name} placeholder="e.g. team-dashboard" aria-label="new vibeable name" onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="run-btn" type="submit" disabled={!!busy.__new || !name.trim()}>
            <Icon name={busy.__new ? "progress_activity" : "add"} className="ms-sm" />
            {busy.__new ? "creating…" : "new vibeable"}
          </button>
        </div>
        {errors.__new && <div className="settings-err">{errors.__new}</div>}
        <div className="settings-note">
          A small app built live with an agent. One folder each under <code title={view.root}>{view.root}</code>; part of the workspace, commit it from the git screen.
        </div>
      </form>
    );
  else if (slug && !current) main = <div className="empty">no vibeable named {slug}</div>;
  else if (current) {
    const a = current;
    const st = stateOf(a);
    const verb = busy[a.slug];
    main = (
      <div className="chat-main vibe-main">
        <div className="detail-head">
          <Lamp status={st.cls} />
          <h1>{a.slug}</h1>
          <span className={`status-word ${st.cls}`}>{st.label}</span>
          {a.updatedAt && <span className="rid" title={a.updatedAt}>changed {fmtAgo(a.updatedAt)}</span>}
          {expert && <span className="rid" title={a.path}>{a.path}</span>}
          <span className="spacer" />
          <label className="vibeables-agent">
            <select value={agent} onChange={(e) => pickAgent(e.target.value as ChatAgentId)} aria-label="agent for new chats">
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="pi">pi</option>
            </select>
          </label>
          <button className="run-btn" disabled={!!verb} onClick={() => void open(a.slug)} title={`Start a ${agent} chat with this app in the preview pane`}>
            <Icon name={verb === "open" ? "progress_activity" : "chat"} className="ms-sm" /> open in chat
          </button>
          {!confirmRemove ? (
            <button className="stop-btn" disabled={!!verb} onClick={() => setConfirmRemove(true)} title="Delete the folder; its history stays in the workspace git">
              <Icon name="delete" className="ms-sm" /> remove
            </button>
          ) : (
            <>
              <button className="stop-btn" onClick={() => void remove(a.slug)}>
                <Icon name="delete" className="ms-sm" /> confirm remove
              </button>
              <button className="open-raw" onClick={() => setConfirmRemove(false)}>cancel</button>
            </>
          )}
        </div>
        {(a.configError || errors[a.slug]) && <div className="settings-err">{a.configError || errors[a.slug]}</div>}
        <VibePane key={a.slug} slug={a.slug} />
      </div>
    );
  } else main = <div className="empty">loading…</div>;

  return (
    <div className="runs-screen vibeables-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">vibeables</span>
          <span className="spacer" />
          {view?.enabled && <span className="microlabel num">{apps.length}</span>}
          {view?.enabled && (
            <Link href="/vibeables/new" className="open-raw">
              <Icon name="add" className="ms-sm" /> new
            </Link>
          )}
        </div>
        <label className="side-filter">
          <Icon name="filter_list" className="ms-sm" />
          <input type="search" value={filter} placeholder="search vibeables" aria-label="search vibeables" onChange={(e) => setFilter(e.target.value)} />
        </label>
        <div className="side-list">
          {shown.map((a) => {
            const st = stateOf(a);
            return (
              <Link key={a.slug} href={`/vibeables/${encodeURIComponent(a.slug)}`} className={`side-row vibeable-row ${a.slug === slug ? "active" : ""}`} data-vibeable={a.slug}>
                <span className={`lamp ${st.cls}`} />
                <div className="side-row-body">
                  <div className="side-row-top">
                    <span className="side-wf">{a.slug}</span>
                    {a.updatedAt && <span className="side-when num" title={a.updatedAt}>{fmtAgo(a.updatedAt)}</span>}
                  </div>
                  <div className="side-row-sub">
                    <span className="side-req">{st.label}{a.dev ? ` · ${a.dev}` : ""}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          {view && apps.length === 0 && <div className="viewer-note">nothing built yet</div>}
          {view && apps.length > 0 && shown.length === 0 && <div className="viewer-note">no vibeable matches</div>}
          {loadError && <div className="viewer-note settings-err">{loadError}</div>}
        </div>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}
