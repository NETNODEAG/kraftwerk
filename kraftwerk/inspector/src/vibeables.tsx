import { useCallback, useEffect, useRef, useState } from "react";
import { fmtAgo, Icon, navigate, useExpertMode } from "./shared";
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
  chatId: string;
  slug: string;
  /** A turn is running: closing would move the agent mid-work, so the server refuses it. */
  agentBusy?: boolean;
  onClosed: (meta: ChatMeta) => void;
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

  const devLive = !!status?.dev?.running && !!status.dev.ready;
  const devUrl = status?.dev ? `${window.location.protocol}//${window.location.hostname}:${status.dev.port}/` : "";
  const src = devLive ? devUrl : status ? `${status.url}?v=${tick}` : "";

  const reload = () => {
    if (devLive) {
      const el = frame.current;
      if (el) el.src = el.src;
    } else setTick((t) => t + 1);
  };

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
          onClick={() => window.open(devLive ? devUrl : status?.url ?? "", "_blank", "noopener")}
          disabled={!status}
          title="Open in a new tab"
          aria-label="open in new tab"
        >
          <Icon name="open_in_new" />
        </button>
        <button
          className="icon-btn"
          onClick={() => void close()}
          disabled={!!busy || agentBusy}
          title={agentBusy ? "The agent is working — close the preview when the turn is done" : "Close the preview (the agent returns to the project root)"}
          aria-label="close preview"
        >
          <Icon name={busy === "close" ? "progress_activity" : "close"} />
        </button>
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
          sandbox={devLive ? "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" : "allow-scripts allow-forms allow-popups allow-modals allow-downloads"}
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
 * Vibeables (#/vibeables): every app under the root, newest change first.
 * Create one, open it in a fresh chat, preview it, remove it. Shown only
 * when kraftwerk.yml turns the feature on.
 */
export function VibeablesScreen() {
  const [view, setView] = useState<VibeablesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
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

  const mark = (slug: string, verb: string) => setBusy((b) => ({ ...b, [slug]: verb }));
  const unmark = (slug: string) =>
    setBusy((b) => {
      const next = { ...b };
      delete next[slug];
      return next;
    });
  const fail = (slug: string, err: unknown) => setErrors((e) => ({ ...e, [slug]: (err as Error).message }));

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
    } catch (err) {
      fail("__new", err);
    } finally {
      unmark("__new");
    }
  };

  const open = async (slug: string) => {
    mark(slug, "open");
    try {
      await openInChat(slug, agent);
    } catch (err) {
      fail(slug, err);
      unmark(slug);
    }
  };

  const remove = async (slug: string) => {
    mark(slug, "remove");
    setConfirmRemove(null);
    try {
      const r = await fetch(`/api/vibeables/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
    } catch (err) {
      fail(slug, err);
    } finally {
      unmark(slug);
      void reload();
    }
  };

  const pickAgent = (a: ChatAgentId) => {
    setAgent(a);
    try {
      localStorage.setItem(AGENT_KEY, a);
    } catch {}
  };

  // Newest change first; the API lists alphabetically.
  const apps = [...(view?.vibeables ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <div className="settings-screen ws-screen vibeables-screen">
      <div className="settings-head">
        <h1><Icon name="web" className="ms-lg" /> Vibeables</h1>
        <span className="spacer" />
        {view?.enabled && <span className="settings-note">{apps.length} app{apps.length === 1 ? "" : "s"}</span>}
        {loadError && <span className="settings-err">{loadError}</span>}
      </div>

      {view && !view.enabled && (
        <section className="panel">
          <div className="ws-empty">
            {view.error && !/are off/.test(view.error) ? (
              <span className="settings-err">{view.error}</span>
            ) : (
              <>
                Vibeables are off. Turn them on in <a href="#/settings">settings</a> or add a <code>vibeables:</code> block to kraftwerk.yml.
              </>
            )}
          </div>
        </section>
      )}

      {view?.enabled && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">new vibeable</span>
            <span className="spacer" />
            <span className="settings-note">one folder each under <code title={view.root}>{view.root}</code></span>
          </div>
          <form className="agent-form" onSubmit={(e) => void create(e)}>
            <div className="agent-form-row">
              <label className="agent-field" style={{ flex: 1 }}>
                name
                <input value={name} placeholder="e.g. team-dashboard" onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <button className="ws-btn primary" type="submit" disabled={!!busy.__new || !name.trim()}>
                <Icon name={busy.__new ? "progress_activity" : "add"} className="ms-sm" />
                {busy.__new ? "creating…" : "create"}
              </button>
            </div>
            {errors.__new && <div className="settings-err">{errors.__new}</div>}
            <div className="settings-note">
              A small app built live with an agent: a chat on the left, the app rendered on the right, every saved file shows up
              at once. Part of the workspace — commit it from the git screen.
            </div>
          </form>
        </section>
      )}

      {view?.enabled && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">vibeables · newest change first</span>
            <span className="spacer" />
            <label className="vibeables-agent">
              open in chat with
              <select value={agent} onChange={(e) => pickAgent(e.target.value as ChatAgentId)} aria-label="agent for new chats">
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="pi">pi</option>
              </select>
            </label>
          </div>
          {apps.length === 0 && <div className="ws-empty">Nothing built yet — create one above, or press the vibeable button in any chat.</div>}
          {apps.map((a) => {
            const verb = busy[a.slug];
            const state = a.configError ? { label: "config error", cls: "missing" } : a.hasIndex ? { label: a.dev ? "dev" : "static", cls: "running" } : { label: "no index.html yet", cls: "stopped" };
            return (
              <div key={a.slug} className={`ws-row vibeable-row state-${state.cls}`} data-vibeable={a.slug}>
                <span className="vibeable-repo-icon ws-icon"><Icon name={a.dev ? "terminal" : "web"} /></span>
                <div className="ws-main">
                  <div className="ws-title">
                    <span className="ws-name">{a.slug}</span>
                    <span className={`ws-state ws-state-${state.cls}`}>{state.label}</span>
                    {a.updatedAt && <span className="vibeable-when" title={a.updatedAt}>changed {fmtAgo(a.updatedAt)}</span>}
                  </div>
                  {a.dev && <div className="ws-root" title="dev command from vibeable.yml"><code>{a.dev}</code></div>}
                  {expert && <div className="ws-root ws-dim" title={a.path}>{a.path}</div>}
                  {a.configError && <div className="settings-err">{a.configError}</div>}
                  {errors[a.slug] && <div className="settings-err">{errors[a.slug]}</div>}
                </div>
                <div className="ws-actions">
                  <button className="ws-btn primary" disabled={!!verb} onClick={() => void open(a.slug)} title={`Start a ${agent} chat with this app in the preview pane`}>
                    <Icon name={verb === "open" ? "progress_activity" : "chat"} className="ms-sm" /> open in chat
                  </button>
                  <a className="ws-btn" href={`/vibeables/${encodeURIComponent(a.slug)}/`} target="_blank" rel="noopener" title="Open the static preview in a new tab">
                    <Icon name="open_in_new" className="ms-sm" /> preview
                  </a>
                  {confirmRemove !== a.slug && (
                    <button className="ws-btn" disabled={!!verb} onClick={() => setConfirmRemove(a.slug)} title="Delete the folder; its history stays in the workspace git">
                      <Icon name="delete" className="ms-sm" /> remove
                    </button>
                  )}
                  {confirmRemove === a.slug && (
                    <>
                      <button className="ws-btn danger" onClick={() => void remove(a.slug)}>
                        <Icon name="delete" className="ms-sm" /> confirm remove
                      </button>
                      <button className="ws-btn" onClick={() => setConfirmRemove(null)}>cancel</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
