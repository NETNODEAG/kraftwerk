import { useCallback, useEffect, useState } from "react";
import { api, failure } from "./api";
import { DiffView, FileStatus, NOTE, PANEL_EMPTY } from "./git";
import { fmtAgo, Icon, Link, useExpertMode } from "./shared";
import { Button, cn, EmptyState, Field, Notice, Page, PageHeader, Panel, Tag, TextField, Title } from "./ui";
import type { RepoDetail, RepoInfo, ReposView } from "./types";

/**
 * Repositories (#/repos): the git clones under the project's repos root,
 * read live from git. Add one by url, fetch/fast-forward, remove. The
 * folder is the registry — a clone an agent made by hand shows up here
 * too. Shown only when kraftwerk.yml turns the feature on. #/repos/<slug>
 * is one clone's page: what is happening inside — changed files with
 * their diffs, and the recent commits with the unpushed ones marked.
 */

/** "github.com/org/repo" for the row; the full url stays in the title. */
const shortUrl = (url: string): string =>
  url.replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/").replace(/\.git$/, "");

type RepoState = "clean" | "changed" | "behind" | "unreadable";
const stateOf = (r: RepoInfo): { label: string; state: RepoState } => {
  if (r.error) return { label: "unreadable", state: "unreadable" };
  if (r.dirty) return { label: `${r.dirty} changed`, state: "changed" };
  if (r.ahead) return { label: `${r.ahead} to push`, state: "clean" };
  if (r.behind) return { label: `${r.behind} behind`, state: "behind" };
  return { label: "clean", state: "clean" };
};

/** The state word after the name: green when clean, amber with local changes, red when git cannot read it. */
function StateWord({ label, state }: { label: string; state: RepoState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-2xs font-semibold tracking-[0.4px] uppercase",
        state === "clean" ? "text-ok" : state === "changed" ? "text-ask" : state === "unreadable" ? "text-bad" : "text-fg-2"
      )}
    >
      {label}
    </span>
  );
}

const BRANCH = "rounded-full border border-line px-[7px] py-px font-mono text-xs text-fg-2";
/** A file or commit line that opens its diff. */
const ITEM = "border-line px-[18px] py-2 [&+&]:border-t";
const ITEM_BUTTON =
  "group/item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-0.5 text-left font-[inherit] text-fg";
const ITEM_PATH = "min-w-0 truncate font-mono text-[12.5px] group-hover/item:underline";

function BackHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="quiet" icon="arrow_back" href="/repos" title="all repositories">
        repositories
      </Button>
      <Icon name="folder_data" className="text-[26px] text-fg-2" />
      <Title>{title}</Title>
      {children}
    </header>
  );
}

/** Mirrors the server's remove guard: anything it would refuse without force. */
const needsForce = (r: RepoInfo): boolean => !!(r.error || r.dirty || r.ahead === undefined || r.ahead);

export function ReposScreen({ slug }: { slug?: string }) {
  if (slug) return <RepoPage slug={slug} />;
  return <ReposList />;
}

/**
 * One clone: state, changed files (click for the diff against HEAD), line
 * counts, and the recent commits (click for the patch). Polled, so an agent
 * working in the clone is watched live.
 */
function RepoPage({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  // A 404 (removed), 409 (feature off) or any other answer is shown, not swallowed.
  const [loadError, setLoadError] = useState("");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [verb, setVerb] = useState("");
  const [actionError, setActionError] = useState("");
  const [version, setVersion] = useState(0);
  const expert = useExpertMode();

  const reload = useCallback(async () => {
    try {
      const r = await api.request("repos.get", { slug });
      if (!r.ok) throw new Error(failure(r));
      setDetail(r.data);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "could not load the repository");
    }
  }, [slug]);

  // Polled, so an agent working in the clone is watched live; `version` forces a fresh read after an action.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await reload();
      if (alive) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reload, version]);

  const update = async () => {
    setVerb("update");
    setActionError("");
    try {
      const r = await api.request("repos.update", { slug });
      if (!r.ok || !r.data.ok) throw new Error(r.error || "failed");
      if (r.data.error) setActionError(r.data.error);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setVerb("");
      setVersion((v) => v + 1);
    }
  };

  if (loadError && !detail) {
    return (
      <Page className="repo-page">
        <BackHead title={slug} />
        <Notice tone="bad">{loadError}</Notice>
      </Page>
    );
  }
  if (!detail) return <EmptyState>loading…</EmptyState>;
  const st = stateOf(detail);
  const unpushed = detail.commits.filter((c) => c.local).length;

  return (
    <Page className="repo-page">
      <BackHead title={detail.slug}>
        {detail.branch && <span className={BRANCH}>{detail.branch}</span>}
        {detail.upstream && <span className={NOTE} title="upstream">→ {detail.upstream}</span>}
        <StateWord {...st} />
        <span className="flex-1" />
        <Button size="sm" icon="sync" busy={verb === "update"} disabled={!!verb} onClick={() => void update()} title="git fetch, then fast-forward when clean">
          {verb === "update" ? "updating…" : "update"}
        </Button>
      </BackHead>
      <div className={cn(NOTE, "flex flex-wrap gap-x-3.5 gap-y-1")}>
        {detail.url && <span title={detail.url}>{shortUrl(detail.url)}</span>}
        {expert && <span title={detail.path}>{detail.path}</span>}
        {detail.head && <span>at <code>{detail.head}</code>{detail.committedAt ? ` · ${fmtAgo(detail.committedAt)}` : ""}</span>}
        {!!detail.ahead && <span>{detail.ahead} to push</span>}
        {!!detail.behind && <span>{detail.behind} behind</span>}
        {detail.updatedAt && <span>changed {fmtAgo(detail.updatedAt)}</span>}
      </div>
      {(detail.error || actionError || loadError) && <Notice tone="bad">{detail.error || actionError || loadError}</Notice>}

      <Panel
        title="changes · working tree against HEAD"
        actions={
          <span className={NOTE}>
            {detail.files.length} file{detail.files.length === 1 ? "" : "s"}
            {detail.insertions || detail.deletions ? (
              <> · <span className="text-ok">+{detail.insertions}</span> <span className="text-bad">−{detail.deletions}</span></>
            ) : null}
          </span>
        }
      >
        {detail.files.length === 0 && <p className={PANEL_EMPTY}>Clean — nothing changed since the last commit.</p>}
        {detail.files.map((f) => (
          <div key={f.path} className={cn("repo-file", ITEM)} data-file={f.path}>
            <button type="button" className={ITEM_BUTTON} onClick={() => setOpenFile(openFile === f.path ? null : f.path)}>
              <Icon name={openFile === f.path ? "expand_more" : "chevron_right"} className="ms-sm" />
              <FileStatus status={f.status} />
              <span className={ITEM_PATH}>{f.path}</span>
            </button>
            {openFile === f.path && (
              <DiffView source={{ route: "repos.diff", input: { slug, query: { path: f.path } } }} refresh={detail.updatedAt} />
            )}
          </div>
        ))}
      </Panel>

      <Panel title="commits · newest first" actions={<span className={NOTE}>{unpushed ? `${unpushed} not pushed` : detail.commits.length ? "all pushed" : ""}</span>}>
        {detail.commits.length === 0 && <p className={PANEL_EMPTY}>No commits yet.</p>}
        {detail.commits.map((c) => (
          <div key={c.hash} className={cn("repo-commit", ITEM)} data-commit={c.short}>
            <button type="button" className={ITEM_BUTTON} onClick={() => setOpenCommit(openCommit === c.hash ? null : c.hash)} title={c.hash}>
              <Icon name={openCommit === c.hash ? "expand_more" : "chevron_right"} className="ms-sm" />
              <code className="text-xs">{c.short}</code>
              <span className="min-w-0 truncate text-sm group-hover/item:underline">{c.subject}</span>
              {c.local && <Tag tone="accent">not pushed</Tag>}
              <span className={cn(NOTE, "ml-auto flex-none")}>{c.author} · {fmtAgo(c.committedAt)}</span>
            </button>
            {openCommit === c.hash && <DiffView source={{ route: "repos.commit", input: { slug, hash: c.hash } }} />}
          </div>
        ))}
      </Panel>
    </Page>
  );
}

function ReposList() {
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
      const r = await api.request("repos.list");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView(r.data);
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
          ? await api.request("repos.update", { slug })
          : await api.request("repos.remove", { slug, query: { force } });
      if (!r.ok || !r.data.ok) throw new Error(r.error || "failed");
      const warning = r.data.error;
      if (warning) setErrors((e) => ({ ...e, [slug]: warning }));
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
      const r = await api.request("repos.add", { body: { url: url.trim(), name: name.trim() || undefined, branch: branch.trim() || undefined } });
      if (!r.ok) throw new Error(r.error || "clone failed");
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

  // Newest change first; the API lists alphabetically.
  const repos = [...(view?.repos ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <Page>
      <PageHeader
        icon="source"
        title="Repositories"
        actions={
          <>
            {view?.enabled && <span className={NOTE}>{repos.length} cloned</span>}
            {loadError && <Notice tone="bad">{loadError}</Notice>}
          </>
        }
      />

      {view && !view.enabled && (
        <Panel>
          <div className={PANEL_EMPTY}>
            {view.error && !/are off/.test(view.error) ? (
              <Notice tone="bad">{view.error}</Notice>
            ) : (
              <>
                Repositories are off. Turn them on in <a href="#/settings">settings</a> or add a <code>repos:</code> block to kraftwerk.yml.
              </>
            )}
          </div>
        </Panel>
      )}

      {view?.enabled && (
        <Panel title="add a repository" actions={<span className={NOTE}>clones into <code title={view.root}>{view.root}</code></span>}>
          <form className="flex flex-col gap-2.5 p-[18px]" onSubmit={(e) => void add(e)}>
            <div className="flex flex-wrap items-end gap-2.5">
              <Field label="url" className="min-w-[240px] flex-[2]">
                <TextField
                  value={url}
                  placeholder="https://github.com/org/repo.git, git@host:org/repo.git or github:org/repo"
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="name" className="min-w-[140px] flex-1">
                <TextField value={name} placeholder="from the url" onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="branch" className="w-[140px]">
                <TextField value={branch} placeholder="default" onChange={(e) => setBranch(e.target.value)} />
              </Field>
              <Button type="submit" variant="primary" icon="download" busy={adding} disabled={!url.trim()}>
                {adding ? "cloning…" : "clone"}
              </Button>
            </div>
            {addError && <Notice tone="bad">{addError}</Notice>}
            <p className={cn(NOTE, "m-0")}>
              Uses your own git credentials and never prompts: a private remote must already work from a terminal.
              Agents see every clone here and can add more with <code>kraftwerk repos add</code>.
            </p>
          </form>
        </Panel>
      )}

      {view?.enabled && (
        <Panel title="cloned repositories · newest change first">
          {repos.length === 0 && <p className={PANEL_EMPTY}>Nothing cloned yet.</p>}
          {repos.map((r) => {
            const verb = busy[r.slug];
            const st = stateOf(r);
            return (
              <div
                key={r.slug}
                className={cn(
                  "repo-row grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3.5 border-line px-[18px] py-3.5 [&+&]:border-t",
                  st.state === "changed" && "bg-ask-soft/40"
                )}
                data-repo={r.slug}
              >
                <span className={cn("grid size-10 place-items-center rounded-full bg-surface-2 text-fg-2", st.state === "unreadable" && "opacity-45 grayscale")}>
                  <Icon name="folder_data" className="text-[22px]" />
                </span>
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link href={`/repos/${encodeURIComponent(r.slug)}`} className="text-md font-semibold text-fg no-underline hover:underline" title="changes and commits">
                      {r.slug}
                    </Link>
                    {r.branch && <span className={BRANCH}>{r.branch}</span>}
                    <StateWord {...st} />
                    {r.updatedAt && <span className={NOTE} title={r.updatedAt}>changed {fmtAgo(r.updatedAt)}</span>}
                  </div>
                  {r.url && <div className="font-mono text-xs [overflow-wrap:anywhere] text-fg-2" title={r.url}>{shortUrl(r.url)}</div>}
                  {expert && <div className="text-xs [overflow-wrap:anywhere] text-fg-2 opacity-70" title={r.path}>{r.path}</div>}
                  <div className={cn(NOTE, "flex flex-wrap gap-x-3.5 gap-y-1 [&_code]:text-[11.5px]")}>
                    {r.head && (
                      <span title={r.committedAt}>
                        <code>{r.head}</code> {r.subject}
                        {r.committedAt ? ` · ${fmtAgo(r.committedAt)}` : ""}
                      </span>
                    )}
                    {!!r.behind && !!r.dirty && <span>behind by {r.behind}</span>}
                    {r.error && <span className="text-bad">{r.error}</span>}
                  </div>
                  {errors[r.slug] && <Notice tone="bad">{errors[r.slug]}</Notice>}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button size="sm" icon="difference" href={`/repos/${encodeURIComponent(r.slug)}`} title="changed files with diffs, recent commits">
                    changes
                  </Button>
                  <Button size="sm" icon="sync" busy={verb === "update"} disabled={!!verb} onClick={() => void call(r.slug, "update")} title="git fetch, then fast-forward when clean">
                    {verb === "update" ? "updating…" : "update"}
                  </Button>
                  {confirmRemove !== r.slug && (
                    <Button size="sm" icon="delete" disabled={!!verb} onClick={() => setConfirmRemove(r.slug)} title="Move the clone to the trash">
                      remove
                    </Button>
                  )}
                  {confirmRemove === r.slug && (
                    <>
                      <Button size="sm" variant="danger" icon="delete" onClick={() => void call(r.slug, "remove", needsForce(r))}>
                        {r.dirty || r.ahead ? "delete with local changes" : needsForce(r) ? "delete anyway" : "confirm remove"}
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(null)}>cancel</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </Page>
  );
}
