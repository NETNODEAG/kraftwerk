import { useCallback, useEffect, useState } from "react";
import { fmtAgo, Icon, useExpertMode } from "./shared";
import type { RepoInfo, ReposView } from "./types";

/**
 * Repositories (#/repos): the git clones under the project's repos root,
 * read live from git. Add one by url, fetch/fast-forward, remove. The
 * folder is the registry — a clone an agent made by hand shows up here
 * too. Shown only when kraftwerk.yml turns the feature on.
 */

/** "github.com/org/repo" for the row; the full url stays in the title. */
const shortUrl = (url: string): string =>
  url.replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/").replace(/\.git$/, "");

const stateOf = (r: RepoInfo): { label: string; cls: string } => {
  if (r.error) return { label: "unreadable", cls: "missing" };
  if (r.dirty) return { label: `${r.dirty} changed`, cls: "died" };
  if (r.ahead) return { label: `${r.ahead} to push`, cls: "running" };
  if (r.behind) return { label: `${r.behind} behind`, cls: "stopped" };
  return { label: "clean", cls: "running" };
};

/** Mirrors the server's remove guard: anything it would refuse without force. */
const needsForce = (r: RepoInfo): boolean => !!(r.error || r.dirty || r.ahead === undefined || r.ahead);

export function ReposScreen() {
  const [view, setView] = useState<ReposView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const expert = useExpertMode();

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/repos", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView((await r.json()) as ReposView);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "could not load repositories");
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

  const call = async (slug: string, verb: "update" | "remove", force = false) => {
    setBusy((b) => ({ ...b, [slug]: verb }));
    setErrors((e) => ({ ...e, [slug]: "" }));
    setConfirmRemove(null);
    try {
      const r =
        verb === "update"
          ? await fetch(`/api/repos/${encodeURIComponent(slug)}/update`, { method: "POST" })
          : await fetch(`/api/repos/${encodeURIComponent(slug)}${force ? "?force=1" : ""}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      if (d.error) setErrors((e) => ({ ...e, [slug]: d.error! }));
    } catch (err) {
      setErrors((e) => ({ ...e, [slug]: (err as Error).message }));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[slug];
        return next;
      });
      void reload();
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || adding) return;
    setAdding(true);
    setAddError("");
    try {
      const r = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined, branch: branch.trim() || undefined }),
      });
      const d = (await r.json()) as RepoInfo & { error?: string };
      if (!r.ok) throw new Error(d.error || "clone failed");
      setUrl("");
      setName("");
      setBranch("");
      await reload();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const repos = view?.repos ?? [];

  return (
    <div className="settings-screen ws-screen repos-screen">
      <div className="settings-head">
        <h1><Icon name="source" className="ms-lg" /> Repositories</h1>
        <span className="spacer" />
        {view?.enabled && <span className="settings-note">{repos.length} cloned</span>}
        {loadError && <span className="settings-err">{loadError}</span>}
      </div>

      {view && !view.enabled && (
        <section className="panel">
          <div className="ws-empty">
            {view.error && !/are off/.test(view.error) ? (
              <span className="settings-err">{view.error}</span>
            ) : (
              <>
                Repositories are off. Turn them on in <a href="#/settings">settings</a> or add a <code>repos:</code> block to kraftwerk.yml.
              </>
            )}
          </div>
        </section>
      )}

      {view?.enabled && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">add a repository</span>
            <span className="spacer" />
            <span className="settings-note">clones into <code title={view.root}>{view.root}</code></span>
          </div>
          <form className="agent-form" onSubmit={(e) => void add(e)}>
            <div className="agent-form-row">
              <label className="agent-field" style={{ flex: 2 }}>
                url
                <input
                  value={url}
                  placeholder="https://github.com/org/repo.git, git@host:org/repo.git or github:org/repo"
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="agent-field" style={{ flex: 1 }}>
                name
                <input value={name} placeholder="from the url" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="agent-field" style={{ width: 140 }}>
                branch
                <input value={branch} placeholder="default" onChange={(e) => setBranch(e.target.value)} />
              </label>
              <button className="ws-btn primary" type="submit" disabled={adding || !url.trim()}>
                <Icon name={adding ? "progress_activity" : "download"} className="ms-sm" />
                {adding ? "cloning…" : "clone"}
              </button>
            </div>
            {addError && <div className="settings-err">{addError}</div>}
            <div className="settings-note">
              Uses your own git credentials and never prompts: a private remote must already work from a terminal.
              Agents see every clone here and can add more with <code>kraftwerk repos add</code>.
            </div>
          </form>
        </section>
      )}

      {view?.enabled && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">cloned repositories</span>
          </div>
          {repos.length === 0 && <div className="ws-empty">Nothing cloned yet.</div>}
          {repos.map((r) => {
            const verb = busy[r.slug];
            const st = stateOf(r);
            return (
              <div key={r.slug} className={`ws-row repo-row state-${st.cls}`} data-repo={r.slug}>
                <span className="switcher-icon ws-icon"><Icon name="folder_data" /></span>
                <div className="ws-main">
                  <div className="ws-title">
                    <span className="ws-name">{r.slug}</span>
                    {r.branch && <span className="repo-branch">{r.branch}</span>}
                    <span className={`ws-state ws-state-${st.cls}`}>{st.label}</span>
                  </div>
                  {r.url && (
                    <div className="ws-root" title={r.url}>{shortUrl(r.url)}</div>
                  )}
                  {expert && <div className="ws-root ws-dim" title={r.path}>{r.path}</div>}
                  <div className="ws-meta">
                    {r.head && (
                      <span title={r.committedAt}>
                        <code>{r.head}</code> {r.subject}
                        {r.committedAt ? ` · ${fmtAgo(r.committedAt)}` : ""}
                      </span>
                    )}
                    {!!r.behind && !!r.dirty && <span>behind by {r.behind}</span>}
                    {r.error && <span className="settings-err">{r.error}</span>}
                  </div>
                  {errors[r.slug] && <div className="settings-err">{errors[r.slug]}</div>}
                </div>
                <div className="ws-actions">
                  <button className="ws-btn" disabled={!!verb} onClick={() => void call(r.slug, "update")} title="git fetch, then fast-forward when clean">
                    <Icon name={verb === "update" ? "progress_activity" : "sync"} className="ms-sm" />
                    {verb === "update" ? "updating…" : "update"}
                  </button>
                  {confirmRemove !== r.slug && (
                    <button className="ws-btn" disabled={!!verb} onClick={() => setConfirmRemove(r.slug)} title="Delete the clone">
                      <Icon name="delete" className="ms-sm" /> remove
                    </button>
                  )}
                  {confirmRemove === r.slug && (
                    <>
                      <button className="ws-btn danger" onClick={() => void call(r.slug, "remove", needsForce(r))}>
                        <Icon name="delete" className="ms-sm" />
                        {r.dirty || r.ahead ? "delete with local changes" : needsForce(r) ? "delete anyway" : "confirm remove"}
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
