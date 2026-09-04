import { useCallback, useEffect, useState } from "react";
import { fmtAgo, Icon, post } from "./shared";
import type { GitDiff, GitStatus } from "./types";

/**
 * Workspace git sync (#/git, expert mode). Shows what changed under the
 * workspace roots, lets a human pick files and commit them, and pushes on
 * request. Commit and push are always a click; the server's timer only
 * fetches and fast-forwards.
 */

/** "45s" / "5 min" / "1 h 30 min", so a short interval never reads as "0 min". */
function fmtInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Class for one diff line. Order matters: "+++" is meta before it is an addition. */
const LINE_CLASSES: [RegExp, string][] = [
  [/^(\+\+\+|---|diff |index )/, "d-meta"],
  [/^@@/, "d-hunk"],
  [/^\+/, "d-add"],
  [/^-/, "d-del"],
];
const lineClass = (line: string): string => LINE_CLASSES.find(([re]) => re.test(line))?.[1] ?? "";

/** Unified diff, coloured per line. Small enough not to warrant a library. */
function Diff({ file }: { file: string }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/git/diff?path=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((d: Partial<GitDiff>) => {
        if (!alive) return;
        setText(d.diff ?? "");
        setTruncated(!!d.truncated);
        setError(d.error ?? "");
      })
      .catch(() => alive && setError("could not load the diff"));
    return () => {
      alive = false;
    };
  }, [file]);

  if (error) return <div className="git-diff git-diff-error">{error}</div>;
  if (text === null) return <div className="git-diff">loading…</div>;
  if (!text.trim()) return <div className="git-diff">no textual diff (binary or empty)</div>;

  return (
    <pre className="git-diff">
      {text.split("\n").map((line, i) => (
        <span key={i} className={lineClass(line)}>
          {line || " "}
          {"\n"}
        </span>
      ))}
      {truncated && <span className="d-meta">… diff truncated, see the rest in a terminal{"\n"}</span>}
    </pre>
  );
}

export function GitScreen() {
  const [st, setSt] = useState<GitStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/git", { cache: "no-store" });
      if (r.ok) setSt((await r.json()) as GitStatus);
    } catch {}
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

  // Drop selections for files that are no longer dirty (someone else committed).
  useEffect(() => {
    if (!st?.files) return;
    const live = new Set(st.files.filter((f) => f.syncable).map((f) => f.path));
    setSelected((prev) => {
      const next = new Set([...prev].filter((p) => live.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [st]);

  const act = async (verb: "fetch" | "pull" | "push", body?: unknown) => {
    setBusy(verb);
    setError("");
    setNote("");
    try {
      const d = await post(`/api/git/${verb}`, body);
      if (d.ok) setNote(verb === "push" ? "pushed" : verb === "pull" ? "pulled" : "fetched");
      else setError(d.error || `${verb} failed`);
    } catch (err) {
      setError((err as Error).message || `${verb} failed`);
    } finally {
      setBusy("");
    }
    void reload();
  };

  const commit = async () => {
    setBusy("commit");
    setError("");
    setNote("");
    try {
      const d = await post("/api/git/commit", { paths: [...selected], message });
      if (d.ok) {
        setNote(`committed ${selected.size} file${selected.size === 1 ? "" : "s"}`);
        setSelected(new Set());
        setMessage("");
      } else {
        setError(d.error || "commit failed");
      }
    } catch (err) {
      setError((err as Error).message || "commit failed");
    } finally {
      setBusy("");
    }
    void reload();
  };

  if (!st) return <div className="settings-screen"><div className="ws-empty">loading…</div></div>;

  if (!st.enabled) {
    return (
      <div className="settings-screen">
        <div className="settings-head">
          <h1><Icon name="cloud_sync" className="ms-lg" /> Git sync</h1>
        </div>
        <section className="panel">
          <div className="ws-empty">
            Git sync is off. Turn it on in <a href="#/settings">settings</a>, or add a <code>git:</code> block to kraftwerk.yml.
          </div>
        </section>
      </div>
    );
  }

  const syncable = (st.files ?? []).filter((f) => f.syncable);
  const blocked = (st.files ?? []).filter((f) => !f.syncable);
  const toggle = (p: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  return (
    <div className="settings-screen ws-screen">
      <div className="settings-head">
        <h1><Icon name="cloud_sync" className="ms-lg" /> Git sync</h1>
        <span className="spacer" />
        {note && <span className="settings-saved"><Icon name="check" className="ms-sm" /> {note}</span>}
        {error && <span className="settings-err">{error}</span>}
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">branch</span>
          <span className="spacer" />
          {st.lastFetch && (
            <span className="settings-note" title={st.lastFetch}>fetched {fmtAgo(st.lastFetch)}</span>
          )}
          {st.lastError && (
            <span className="settings-err git-sync-err" title={st.lastError}>
              <Icon name="cloud_off" className="ms-sm" /> {st.lastError.split("\n")[0]}
            </span>
          )}
        </div>
        {st.error ? (
          <div className="ws-empty ws-load-error"><Icon name="error" className="ms-sm" /> {st.error}</div>
        ) : (
          <div className="git-head">
            <div className="git-branch">
              <Icon name="account_tree" className="ms-sm" />
              <strong>{st.branch}</strong>
              {st.upstream ? (
                <span className="settings-note">tracking {st.upstream}</span>
              ) : (
                <span className="settings-note">no upstream yet, push sets one</span>
              )}
            </div>
            <div className="git-counts">
              {st.diverged && <span className="git-diverged">diverged, resolve in a terminal</span>}
              {!!st.behind && <span className="git-behind">{st.behind} behind</span>}
              {!!st.ahead && <span className="git-ahead">{st.ahead} ahead</span>}
              {!st.ahead && !st.behind && <span className="settings-note">up to date</span>}
            </div>
            <div className="ws-actions">
              <button className="ws-btn" disabled={!!busy} onClick={() => void act("fetch")}>
                <Icon name={busy === "fetch" ? "progress_activity" : "refresh"} className="ms-sm" /> fetch
              </button>
              <button
                className="ws-btn"
                disabled={!!busy || !st.behind || st.diverged}
                title={st.diverged ? "Diverged. Resolve in a terminal." : "Fast-forward to the remote"}
                onClick={() => void act("pull")}
              >
                <Icon name={busy === "pull" ? "progress_activity" : "download"} className="ms-sm" /> pull
              </button>
              <button
                className="ws-btn primary"
                disabled={!!busy || (!st.ahead && !!st.upstream)}
                title={st.upstream ? "Push to the upstream" : "Push and set the upstream"}
                onClick={() => void act("push")}
              >
                <Icon name={busy === "push" ? "progress_activity" : "upload"} className="ms-sm" /> push
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">changes</span>
          <span className="spacer" />
          <span className="settings-note">
            {syncable.length === 0 ? "workspace clean" : `${selected.size} of ${syncable.length} selected`}
          </span>
        </div>

        {syncable.length === 0 && blocked.length === 0 && (
          <div className="ws-empty">Nothing changed under the workspace paths.</div>
        )}

        {syncable.map((f) => (
          <div key={f.path} className="git-row">
            <label className="git-pick">
              <input
                type="checkbox"
                checked={selected.has(f.path)}
                onChange={(e) => toggle(f.path, e.target.checked)}
              />
            </label>
            <button
              className="git-file"
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  return next;
                })
              }
            >
              <Icon name={open.has(f.path) ? "expand_more" : "chevron_right"} className="ms-sm" />
              <span className={`git-status s-${f.status}`}>{f.status}</span>
              <span className="git-path">{f.path}</span>
            </button>
            {open.has(f.path) && <Diff file={f.path} />}
          </div>
        ))}

        {syncable.length > 0 && (
          <div className="git-commit">
            <input
              className="git-message"
              placeholder="Commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && message.trim() && selected.size > 0) void commit();
              }}
            />
            <button
              className="ws-btn"
              disabled={selected.size === syncable.length}
              onClick={() => setSelected(new Set(syncable.map((f) => f.path)))}
            >
              select all
            </button>
            <button
              className="ws-btn primary"
              disabled={!!busy || selected.size === 0 || !message.trim()}
              onClick={() => void commit()}
            >
              <Icon name={busy === "commit" ? "progress_activity" : "check"} className="ms-sm" />
              commit {selected.size || ""}
            </button>
          </div>
        )}

        {blocked.length > 0 && (
          <details className="git-blocked">
            <summary>
              {blocked.length}
              {st.blockedHidden ? "+" : ""} change{blocked.length === 1 && !st.blockedHidden ? "" : "s"} outside
              the workspace paths
            </summary>
            {blocked.map((f) => (
              <div key={f.path} className="git-row blocked">
                <span className="git-status s-blocked">{f.status}</span>
                <span className="git-path">{f.path}</span>
                <span className="settings-note">{f.reason}</span>
              </div>
            ))}
            {!!st.blockedHidden && (
              <div className="git-row blocked">
                <span className="settings-note">and {st.blockedHidden} more, not listed</span>
              </div>
            )}
          </details>
        )}
      </section>

      <p className="settings-note">
        Synced paths: {(st.scope ?? []).map((s, i) => (
          <span key={s}>{i > 0 && ", "}<code>{s}</code></span>
        ))}. Run artifacts and files like <code>.env</code> are never staged.{" "}
        {st.interval
          ? `Fetches every ${fmtInterval(st.interval)}${
              st.autosync === "pull" ? " and fast-forwards when the working tree is clean" : ""
            }. `
          : "Background fetching is off. "}
        Commit and push are always manual.
      </p>
    </div>
  );
}
