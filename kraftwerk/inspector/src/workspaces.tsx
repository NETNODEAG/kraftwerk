import { useCallback, useEffect, useState } from "react";
import { fmtAgo, Icon, post } from "./shared";

/**
 * Workspaces admin (#/workspaces, expert mode): every project this machine
 * ever ran the inspector for (~/.kraftwerk/projects), joined with what is
 * running now. Start a stopped one, stop a running one, and drop records
 * whose root no longer holds a kraftwerk.yml. Linked from the workspace
 * switcher popover.
 */

type State = "running" | "stopped" | "died" | "missing" | "orphaned";

interface Workspace {
  name: string;
  icon?: string;
  url: string;
  live: boolean;
  root?: string;
  rootLabel?: string;
  exists?: boolean;
  hasConfig?: boolean;
  dirGone?: boolean;
  current?: boolean;
  state: State;
  lastStarted?: string;
  lastStopped?: string;
  firstSeen?: string;
  startCount?: number;
  counts?: { agents: number; workflows: number; runs: number; chats: number };
}

/** State → the badge text and the explanation next to it. */
const STATE_LABEL: Record<State, { label: string; note?: string }> = {
  running: { label: "running" },
  stopped: { label: "stopped" },
  died: { label: "died", note: "was killed or crashed" },
  missing: { label: "missing", note: "folder is gone" },
  orphaned: { label: "orphaned", note: "no kraftwerk.yml any more" },
};

export function WorkspacesScreen() {
  const [rows, setRows] = useState<Workspace[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({}); // key → verb in flight
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      if (r.ok) {
        setRows((await r.json()) as Workspace[]);
        setLoadError("");
        return;
      }
      // 404 = this inspector predates the endpoint. Say so instead of
      // spinning on "loading…" forever.
      setLoadError(
        r.status === 404
          ? "This workspace runs a kraftwerk without the projects API. Update it and restart its UI."
          : `Could not load the project registry (HTTP ${r.status}).`
      );
    } catch (err) {
      setLoadError((err as Error).message || "Could not reach this workspace's server.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await reload();
      if (alive) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reload]);

  const keyOf = (w: Workspace) => w.root ?? w.url;

  const act = async (w: Workspace, verb: "start" | "stop" | "forget") => {
    const key = keyOf(w);
    setBusy((b) => ({ ...b, [key]: verb }));
    setErrors((e) => ({ ...e, [key]: "" }));
    setConfirmRemove(null);
    try {
      const body = verb === "stop" ? { root: w.root, url: w.url } : { root: w.root };
      const d = await post<{ url?: string; live?: boolean }>(`/api/projects/${verb}`, body);
      if (!d.ok) throw new Error(d.error || "failed");
      window.dispatchEvent(new Event("kw-meta-refresh"));
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: (err as Error).message }));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[key];
        return next;
      });
      void reload();
    }
  };

  const running = rows?.filter((r) => r.live).length ?? 0;

  return (
    <div className="settings-screen ws-screen">
      <div className="settings-head">
        <h1><Icon name="hub" className="ms-lg" /> Workspaces</h1>
        <span className="spacer" />
        {rows && (
          <span className="settings-note">
            {rows.length} known · {running} running
          </span>
        )}
        {rows && loadError && <span className="settings-err">{loadError}</span>}
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">projects on this machine</span>
          <span className="spacer" />
          <span className="settings-note">registry: <code>~/.kraftwerk/projects</code></span>
        </div>
        {!rows && !loadError && <div className="ws-empty">loading…</div>}
        {!rows && loadError && (
          <div className="ws-empty ws-load-error">
            <Icon name="error" className="ms-sm" /> {loadError}
          </div>
        )}
        {rows && rows.length === 0 && <div className="ws-empty">No workspaces known yet.</div>}
        {rows?.map((w) => {
          const key = keyOf(w);
          const verb = busy[key];
          const removable = !w.live && !!w.root && (w.exists === false || w.hasConfig === false);
          return (
            <div key={key} className={`ws-row state-${w.state} ${w.current ? "current" : ""}`}>
              <span className="switcher-icon ws-icon">{w.icon || "•"}</span>
              <div className="ws-main">
                <div className="ws-title">
                  {w.live && !w.current ? (
                    <a href={w.url} className="ws-name">{w.name}</a>
                  ) : (
                    <span className="ws-name">{w.name}</span>
                  )}
                  {w.current && <span className="switcher-hint">current</span>}
                  <span className={`ws-state ws-state-${w.state}`}>
                    {w.live && <span className="live-dot" />}
                    {STATE_LABEL[w.state].label}
                  </span>
                  {STATE_LABEL[w.state].note && (
                    <span className="ws-note">{STATE_LABEL[w.state].note}</span>
                  )}
                </div>
                <div className="ws-root" title={w.root}>
                  {w.rootLabel ?? <span className="ws-dim">no root recorded (started by an older version)</span>}
                </div>
                <div className="ws-meta">
                  {w.state !== "missing" && w.state !== "orphaned" && (
                    <span>{w.url.replace(/^https?:\/\//, "")}</span>
                  )}
                  {w.counts && (
                    <>
                      <span>{w.counts.agents} agents</span>
                      <span>{w.counts.workflows} workflows</span>
                      <span>{w.counts.runs} runs</span>
                      <span>{w.counts.chats} chats</span>
                    </>
                  )}
                  {w.lastStarted && <span title={w.lastStarted}>started {fmtAgo(w.lastStarted)}</span>}
                  {!w.live && w.lastStopped && <span title={w.lastStopped}>stopped {fmtAgo(w.lastStopped)}</span>}
                  {w.startCount != null && <span>{w.startCount}× launched</span>}
                  {w.firstSeen && <span title={w.firstSeen}>first seen {fmtAgo(w.firstSeen)}</span>}
                </div>
                {errors[key] && <div className="settings-err">{errors[key]}</div>}
              </div>
              <div className="ws-actions">
                {w.live && !w.current && (
                  <a className="ws-btn" href={w.url} title="Open this workspace">
                    <Icon name="open_in_new" className="ms-sm" /> open
                  </a>
                )}
                {!w.live && w.root && w.exists !== false && !w.dirGone && (
                  <button className="ws-btn primary" disabled={!!verb} onClick={() => void act(w, "start")}>
                    <Icon name={verb === "start" ? "progress_activity" : "play_arrow"} className="ms-sm" />
                    {verb === "start" ? "starting…" : "start"}
                  </button>
                )}
                {w.live && !w.current && (
                  <button className="ws-btn danger" disabled={!!verb} onClick={() => void act(w, "stop")}>
                    <Icon name={verb === "stop" ? "progress_activity" : "stop"} className="ms-sm" />
                    {verb === "stop" ? "stopping…" : "stop"}
                  </button>
                )}
                {removable && confirmRemove !== key && (
                  <button className="ws-btn" disabled={!!verb} title="Drop this project from the registry (files untouched)" onClick={() => setConfirmRemove(key)}>
                    <Icon name="delete" className="ms-sm" /> remove
                  </button>
                )}
                {removable && confirmRemove === key && (
                  <>
                    <button className="ws-btn danger" onClick={() => void act(w, "forget")}>
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

      <p className="settings-note">
        Start launches <code>kraftwerk ui</code> detached in the project root (log in <code>~/.kraftwerk/logs</code>).
        Stop sends SIGTERM to the running server. Remove is offered only for records whose root no
        longer holds a <code>kraftwerk.yml</code> — the same from the terminal:{" "}
        <code>kraftwerk projects</code>.
      </p>
    </div>
  );
}
