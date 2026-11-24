import { useCallback, useRef, useEffect, useState } from "react";
import { api, failure, type CallInput } from "./api";
import { fmtAgo, Icon } from "./shared";
import { Button, cn, EmptyState, Notice, Page, PageHeader, Panel, TextField } from "./ui";
import type { GitCommit, GitStatus } from "./types";
import { useWorkspaceCloud } from "./cloud-mode";

/**
 * Workspace git sync (#/git, expert mode). Shows what changed under the
 * workspace roots, lets a human pick files and commit them, and pushes on
 * request. The server's timer fetches and fast-forwards, pushes with
 * `autosync: push`, and with `autosync: sync` (kraftwerk sync's default)
 * also commits by itself and merges the remote in, keeping this machine's
 * side of a conflict beside the remote's.
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
  [/^(\+\+\+|---|diff |index )/, "text-fg-2 opacity-80"],
  [/^@@/, "text-accent"],
  [/^\+/, "text-ok"],
  [/^-/, "text-bad"],
];
const lineClass = (line: string): string => LINE_CLASSES.find(([re]) => re.test(line))?.[1] ?? "";

/** The workspace repo's diff of one changed file. */
function Diff({ file }: { file: string }) {
  return <DiffView source={{ route: "git.diff", input: { query: { path: file } } }} />;
}

/** The routes that answer a GitDiff. */
export type DiffSource =
  | { route: "git.diff"; input: CallInput<"git.diff"> }
  | { route: "repos.diff"; input: CallInput<"repos.diff"> }
  | { route: "repos.commit"; input: CallInput<"repos.commit"> }
  | { route: "git.commitDiff"; input: CallInput<"git.commitDiff"> };

const loadDiff = (s: DiffSource) =>
  s.route === "git.diff"
    ? api.request(s.route, s.input)
    : s.route === "repos.diff"
      ? api.request(s.route, s.input)
      : s.route === "git.commitDiff"
        ? api.request(s.route, s.input)
        : api.request(s.route, s.input);

/**
 * Unified diff from any route that answers a GitDiff, coloured per line. Small enough not to warrant a library.
 * A changed `refresh` reloads it (the file changed under the same path).
 */
export function DiffView({ source, refresh }: { source: DiffSource; refresh?: unknown }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");

  const key = JSON.stringify(source);
  useEffect(() => {
    let alive = true;
    setText(null);
    setError("");
    // A diff can also come back with `error` set; error answers (400/404) carry only that.
    loadDiff(source)
      .then((r) => {
        if (!alive) return;
        if (!r.data || typeof r.data !== "object") throw new Error("not json");
        if (!r.ok) {
          setText("");
          setTruncated(false);
          setError(r.error ?? "");
          return;
        }
        setText(r.data.diff ?? "");
        setTruncated(!!r.data.truncated);
        setError(r.data.error ?? "");
      })
      .catch(() => alive && setError("could not load the diff"));
    return () => {
      alive = false;
    };
  }, [key, refresh]);

  if (error) return <div className={cn(DIFF, "text-bad")}>{error}</div>;
  if (text === null) return <div className={DIFF}>loading…</div>;
  if (!text.trim()) return <div className={DIFF}>no textual diff (binary or empty)</div>;

  return (
    <pre className={DIFF}>
      {text.split("\n").map((line, i) => (
        <span key={i} className={lineClass(line)}>
          {line || " "}
          {"\n"}
        </span>
      ))}
      {truncated && <span className="text-fg-2 opacity-80">… diff truncated, see the rest in a terminal{"\n"}</span>}
    </pre>
  );
}

/** `git-diff`: what the tests look for inside a file or commit row. */
const DIFF =
  "git-diff mt-1.5 mb-0.5 max-h-[420px] basis-full overflow-auto rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-[11.5px] leading-[1.5] whitespace-pre";

const STATUS_TONE: Record<string, string> = {
  modified: "text-accent",
  added: "text-ok",
  untracked: "text-ok",
  deleted: "text-bad",
  conflicted: "text-bad",
};

/** A changed file's git status as a small outlined label ("modified", "untracked"). */
export function FileStatus({ status, muted }: { status: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "flex-none rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.4px] uppercase",
        muted ? "text-fg-2" : (STATUS_TONE[status] ?? "text-fg-2")
      )}
    >
      {status}
    </span>
  );
}

/** A short line that explains, beside a control or under a panel. */
export const NOTE = "text-xs text-fg-2";
/** What an empty panel says. */
export const PANEL_EMPTY = "m-0 p-[18px] text-sm text-fg-2";

/** The error a write answered with: its `{error}`, else the HTTP status when it was refused. */
export function GitScreen() {
  const [st, setSt] = useState<GitStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // The first read on opening the screen bypasses the server's short status
  // cache: what the nav badge cached a moment ago may predate the last change.
  const first = useRef(true);
  const reload = useCallback(async () => {
    try {
      const r = await api.request("git.status", { query: { fresh: first.current } });
      first.current = false;
      if (r.ok) setSt(r.data);
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
      const r = await api.request(`git.${verb}`, { body: body ?? {} });
      if (r.ok && r.data.ok) setNote(verb === "push" ? "pushed" : verb === "pull" ? "pulled" : "fetched");
      else setError(failure(r) || `${verb} failed`);
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
      const r = await api.request("git.commit", { body: { paths: [...selected], message } });
      if (r.ok && r.data.ok) {
        setNote(`committed ${selected.size} file${selected.size === 1 ? "" : "s"}`);
        setSelected(new Set());
        setMessage("");
      } else {
        setError(failure(r) || "commit failed");
      }
    } catch (err) {
      setError((err as Error).message || "commit failed");
    } finally {
      setBusy("");
    }
    void reload();
  };

  if (!st) return <EmptyState>loading…</EmptyState>;

  if (!st.enabled) {
    return (
      <Page>
        <PageHeader icon="cloud_sync" title="Git sync" />
        <Panel>
          <p className={PANEL_EMPTY}>
            Git sync is off. Turn it on in <a href="#/settings">settings → git sync</a> — in cloud mode with kraftwerk sync in one click — or add a <code>git:</code> block to kraftwerk.yml.
          </p>
        </Panel>
      </Page>
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
    <Page>
      <PageHeader
        icon="cloud_sync"
        title="Git sync"
        actions={
          <>
            {note && <span className="inline-flex items-center gap-1 text-sm text-ok"><Icon name="check" className="ms-sm" /> {note}</span>}
            {error && <Notice tone="bad">{error}</Notice>}
          </>
        }
      />

      {!st.error && <Repository st={st} />}

      <Panel
        title="branch"
        actions={
          <>
            {st.lastFetch && (
              <span className={NOTE} title={st.lastFetch}>fetched {fmtAgo(st.lastFetch)}</span>
            )}
            {st.lastError && (
              // A fetch error is one line of git stderr; never let it push the head around.
              <span className="inline-flex max-w-[46ch] items-center gap-1 truncate text-xs text-bad" title={st.lastError}>
                <Icon name="cloud_off" className="ms-sm" /> {st.lastError.split("\n")[0]}
              </span>
            )}
          </>
        }
      >
        {st.error ? (
          <div className="flex items-center gap-2 p-[18px] text-sm text-bad"><Icon name="error" className="ms-sm" /> {st.error}</div>
        ) : (
          <div className="flex flex-wrap items-center gap-4 px-[18px] py-3.5">
            <div className="flex items-center gap-2 text-base">
              <Icon name="account_tree" className="ms-sm" />
              <strong className="font-mono">{st.branch}</strong>
              <span className={NOTE}>{st.upstream ? `tracking ${st.upstream}` : "no upstream yet, push sets one"}</span>
            </div>
            <div className="flex items-center gap-2.5 text-[12.5px] font-semibold">
              {st.diverged && <span className="text-bad">diverged, resolve in a terminal</span>}
              {!!st.behind && <span className="text-accent">{st.behind} behind</span>}
              {!!st.ahead && <span className="text-ok">{st.ahead} ahead</span>}
              {!st.ahead && !st.behind && <span className={cn(NOTE, "font-normal")}>up to date</span>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" icon="refresh" busy={busy === "fetch"} disabled={!!busy} onClick={() => void act("fetch")}>
                fetch
              </Button>
              <Button
                size="sm"
                icon="download"
                busy={busy === "pull"}
                disabled={!!busy || !st.behind || st.diverged}
                title={st.diverged ? "Diverged. Resolve in a terminal." : "Fast-forward to the remote"}
                onClick={() => void act("pull")}
              >
                pull
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="upload"
                busy={busy === "push"}
                disabled={!!busy || (!st.ahead && !!st.upstream)}
                title={st.upstream ? "Push to the upstream" : "Push and set the upstream"}
                onClick={() => void act("push")}
              >
                push
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {!!st.conflicts?.length && (
        <Panel title="conflicts kept beside" actions={<span className={NOTE}>two people changed these at once — the version that reached the cloud first stays, the other is next to it</span>}>
          {st.conflicts.map((c) => (
            <div key={c.copy + c.at} className={cn("git-conflict px-[18px]", ROW)}>
              <Icon name="call_split" className="ms-sm text-accent" />
              <span className={PATH}>{c.path}</span>
              <span className={NOTE}>{c.by}'s version:</span>
              <span className={cn(PATH, "text-accent")}>{c.copy}</span>
              <span className={cn(NOTE, "ml-auto")} title={c.at}>{fmtAgo(c.at)}</span>
            </div>
          ))}
          <p className={cn(NOTE, "m-0 border-t border-line px-[18px] py-2.5")}>Compare the two, keep what is right in the original, and delete the copy — the deletion syncs like any change.</p>
        </Panel>
      )}

      <Panel
        title="changes"
        actions={<span className={NOTE}>{syncable.length === 0 ? "workspace clean" : `${selected.size} of ${syncable.length} selected`}</span>}
      >
        {syncable.length === 0 && blocked.length === 0 && <p className={PANEL_EMPTY}>Nothing changed under the workspace paths.</p>}

        {syncable.map((f) => (
          <div key={f.path} className={cn("git-row px-[18px]", ROW)}>
            <input
              type="checkbox"
              className="accent-accent"
              aria-label={`select ${f.path}`}
              checked={selected.has(f.path)}
              onChange={(e) => toggle(f.path, e.target.checked)}
            />
            <button
              type="button"
              className="group/file flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-0.5 text-left font-[inherit] text-fg"
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
              <FileStatus status={f.status} />
              <span className={cn(PATH, "group-hover/file:underline")}>{f.path}</span>
            </button>
            {open.has(f.path) && <Diff file={f.path} />}
          </div>
        ))}

        {syncable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-surface-2 px-[18px] py-3">
            <TextField
              className="min-w-[220px] flex-1 text-sm"
              placeholder="Commit message"
              aria-label="commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && message.trim() && selected.size > 0) void commit();
              }}
            />
            <Button size="sm" disabled={selected.size === syncable.length} onClick={() => setSelected(new Set(syncable.map((f) => f.path)))}>
              select all
            </Button>
            <Button size="sm" variant="primary" icon="check" busy={busy === "commit"} disabled={!!busy || selected.size === 0 || !message.trim()} onClick={() => void commit()}>
              commit {selected.size || ""}
            </Button>
          </div>
        )}

        {blocked.length > 0 && (
          <details className="border-t border-line px-[18px] py-2.5">
            <summary className="cursor-pointer text-[12.5px] text-fg-2">
              {blocked.length}
              {st.blockedHidden ? "+" : ""} change{blocked.length === 1 && !st.blockedHidden ? "" : "s"} outside
              the workspace paths
            </summary>
            {blocked.map((f) => (
              <div key={f.path} className={cn("git-row blocked opacity-60", ROW)}>
                <FileStatus status={f.status} muted />
                <span className={PATH}>{f.path}</span>
                <span className={NOTE}>{f.reason}</span>
              </div>
            ))}
            {!!st.blockedHidden && (
              <div className={cn("git-row blocked opacity-60", ROW)}>
                <span className={NOTE}>and {st.blockedHidden} more, not listed</span>
              </div>
            )}
          </details>
        )}
      </Panel>

      {!st.error && <History refresh={`${st.branch}/${st.ahead}/${st.behind}/${st.lastPull}/${st.lastPush}/${st.lastAutoCommit}/${st.files?.length}`} />}

      {!st.error && <Ignored st={st} />}

      <p className={cn(NOTE, "m-0")}>
        Synced paths: {(st.scope ?? []).map((s, i) => (
          <span key={s}>{i > 0 && ", "}<code>{s}</code></span>
        ))}. Run artifacts and files like <code>.env</code> are never staged.{" "}
        {st.interval && st.autosync === "sync"
          ? `kraftwerk sync every ${fmtInterval(st.interval)}: commits what changed under these paths, takes the remote's changes in and pushes. Where both sides changed a file, the remote's version wins and yours is kept beside it.${
              st.lastAutoCommit ? ` Last automatic commit ${fmtAgo(st.lastAutoCommit)}.` : ""
            } `
          : st.interval
          ? `Fetches every ${fmtInterval(st.interval)}${
              st.autosync === "push"
                ? ", fast-forwards when the working tree is clean and pushes what is committed"
                : st.autosync === "pull"
                  ? " and fast-forwards when the working tree is clean"
                  : ""
            }. `
          : "Background fetching is off. "}
        {st.interval && st.autosync === "sync" ? "A commit by hand goes up at once." : st.interval && st.autosync === "push" ? "Committing is always manual." : "Commit and push are always manual."}
      </p>
    </Page>
  );
}

/** What each hosting says about who manages the remote. */
const HOSTING: Record<NonNullable<GitStatus["hosting"]>, { icon: string; label: string; text: string }> = {
  kraftwerk: {
    icon: "cloud_done",
    label: "managed by kraftwerk",
    text: "kraftwerk sync: this workspace's own repository in kraftwerk cloud. Everyone on the workspace pulls and pushes here, with their cloud account — access follows the workspace's members, no git provider to set up.",
  },
  custom: {
    icon: "construction",
    label: "own git provider · expert mode",
    text: "This workspace syncs through a git server of your own (GitHub, GitLab, Bitbucket, a server in-house). Hosting, access and credentials are yours to manage there; kraftwerk only fetches, pulls and pushes.",
  },
  none: {
    icon: "cloud_off",
    label: "no remote yet",
    text: "History stays on this machine. In cloud mode, kraftwerk sync gives the workspace a repository in kraftwerk cloud and keeps it in step with everyone's; or add a remote of your own with `git remote add`.",
  },
};

/** Where the workspace's history goes, and who manages that place. */
function Repository({ st }: { st: GitStatus }) {
  const { cloud } = useWorkspaceCloud();
  const [copied, setCopied] = useState(false);
  const hosting = st.hosting ?? (st.remoteUrl ? "custom" : "none");
  const h = HOSTING[hosting];
  let host = "";
  try {
    host = st.remoteUrl ? new URL(st.remoteUrl).host : "";
  } catch {
    host = st.remoteUrl?.match(/@([^:]+):/)?.[1] ?? "";
  }
  return (
    <Panel
      title="repository"
      actions={
        <span className={cn("git-hosting inline-flex items-center gap-1 text-xs font-semibold", hosting === "kraftwerk" ? "text-ok" : hosting === "custom" ? "text-accent" : "text-fg-2")}>
          <Icon name={h.icon} className="ms-sm" /> {h.label}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5 px-[18px] py-3.5">
        {st.remoteUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={NOTE}>{st.remote ?? "origin"}</span>
            <code className="git-remote-url min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px]" title={st.remoteUrl}>
              {st.remoteUrl}
            </code>
            <Button
              size="sm"
              icon={copied ? "check" : "content_copy"}
              onClick={() => {
                void navigator.clipboard?.writeText(st.remoteUrl!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "copied" : "copy"}
            </Button>
          </div>
        ) : null}
        <div className={cn(NOTE, "flex flex-wrap items-center gap-x-1.5")}>
          <span>{h.text}</span>
          {st.repoRoot && (
            <span>
              Local folder <code>{st.repoRoot}</code>.
            </span>
          )}
          {hosting === "kraftwerk" && cloud?.workspaceUrl && (
            <a href={cloud.workspaceUrl} target="_blank" rel="noreferrer">
              the workspace in kraftwerk cloud ↗
            </a>
          )}
          {hosting === "custom" && host && <span>Provider: <strong>{host}</strong>.</span>}
          {hosting === "none" && <a href="#/settings">set up kraftwerk sync in settings → git sync</a>}
          {hosting === "custom" && <a href="#/settings/cloud">what kraftwerk sync is</a>}
        </div>
      </div>
    </Panel>
  );
}

/**
 * What was committed: the newest commits that touched the workspace paths,
 * whoever made them (here by hand, kraftwerk sync, another machine), the
 * ones not pushed yet marked. A commit opens as its patch.
 */
function History({ refresh }: { refresh: string }) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .request("git.log", {})
      .then((r) => alive && r.ok && setCommits(r.data.commits))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refresh]);
  if (!commits) return null;
  const unpushed = commits.filter((c) => c.local).length;
  return (
    <Panel title="history · newest first" actions={<span className={NOTE}>{unpushed ? `${unpushed} not pushed` : commits.length ? "all pushed" : ""}</span>}>
      {commits.length === 0 && <p className={cn(NOTE, "m-0 px-[18px] py-3.5")}>No commits under the workspace paths yet.</p>}
      {commits.map((c) => (
        <div key={c.hash} className="git-commit border-line px-[18px] py-2 [&+&]:border-t" data-commit={c.short}>
          <button
            type="button"
            className="group/item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-0.5 text-left font-[inherit] text-fg"
            onClick={() => setOpen(open === c.hash ? null : c.hash)}
            title={c.hash}
          >
            <Icon name={open === c.hash ? "expand_more" : "chevron_right"} className="ms-sm" />
            <code className="text-xs">{c.short}</code>
            <span className="min-w-0 truncate text-sm group-hover/item:underline">{c.subject}</span>
            {c.local && <span className="flex-none rounded-md border border-accent px-1.5 text-[10.5px] font-semibold tracking-wide text-accent uppercase">not pushed</span>}
            <span className={cn(NOTE, "ml-auto flex-none")}>
              {c.author} · {fmtAgo(c.committedAt)}
            </span>
          </button>
          {open === c.hash && <DiffView source={{ route: "git.commitDiff", input: { hash: c.hash } }} />}
        </div>
      ))}
    </Panel>
  );
}

/** What .gitignore keeps out of git — and so out of sync: each file with its rules, the root's open. */
function Ignored({ st }: { st: GitStatus }) {
  const files = st.ignores ?? [];
  const count = files.reduce((n, f) => n + f.rules.length + (f.more ?? 0), 0);
  return (
    <Panel title="ignored" actions={<span className={NOTE}>{files.length ? `${count} rule${count === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}` : "no .gitignore"}</span>}>
      <div className="git-ignored flex flex-col gap-2 px-[18px] py-3.5">
        <div className={NOTE}>Files matching these rules never reach git: they are not listed above, not committed and not synced. Edit a <code>.gitignore</code> to change that.</div>
        {files.map((f, i) => (
          <details key={f.path} open={i === 0} className="git-ignore-file rounded-lg border border-line">
            <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
              <code className="min-w-0 flex-1 truncate font-mono">{f.path}</code>
              <span className={NOTE}>{f.rules.length + (f.more ?? 0)}</span>
            </summary>
            <pre className="m-0 overflow-x-auto border-t border-line bg-surface-2 px-2.5 py-2 font-mono text-[12.5px] leading-relaxed">
              {f.rules.length ? f.rules.join("\n") : "(no rules)"}
              {f.more ? `\n… ${f.more} more` : ""}
            </pre>
          </details>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Settings → git sync: where the workspace's history goes, and — while there
 * is no remote — kraftwerk sync in one click. The one place git sync is set
 * up; the git screen links here.
 */
export function GitRemoteSummary({ onSetup }: { onSetup: () => void }) {
  const [st, setSt] = useState<GitStatus | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.request("git.status", { query: { fresh: true } });
      if (r.ok) setSt(r.data);
    } catch {}
  }, []);
  useEffect(() => void load(), [load]);
  if (!st) return null;
  const hosting = !st.enabled ? "none" : (st.hosting ?? (st.remoteUrl ? "custom" : "none"));
  const h = HOSTING[hosting];
  return (
    <>
      {st.remoteUrl && (
        <div className="git-remote-summary flex flex-wrap items-center gap-2 border-t border-line px-[18px] py-3">
          <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", hosting === "kraftwerk" ? "text-ok" : "text-accent")}>
            <Icon name={h.icon} className="ms-sm" /> {h.label}
          </span>
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-xs" title={st.remoteUrl}>
            {st.remoteUrl}
          </code>
        </div>
      )}
      {hosting === "none" && (
        <SyncSetup
          onDone={() => {
            void load();
            onSetup();
          }}
        />
      )}
    </>
  );
}

/**
 * kraftwerk sync in one click (POST /api/git/sync-setup): a repository if
 * there is none, git sync on, the workspace's cloud repo as the remote, a
 * first commit and push. The daemon brings the machine's key along — nothing
 * to paste. Before cloud mode it says so and links the switch.
 */
export function SyncSetup({ onDone }: { onDone: () => void }) {
  const { cloud } = useWorkspaceCloud();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const ready = cloud?.mode === "cloud" && cloud.steps.claim;
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.request("git.setupSync", { body: {} });
      if (r.ok && r.data.ok) {
        setDone(r.data.done);
        onDone();
      } else {
        if (r.data && typeof r.data === "object" && "done" in r.data && Array.isArray(r.data.done)) setDone(r.data.done);
        setError(failure(r) || "setting up kraftwerk sync failed");
        onDone();
      }
    } catch (err) {
      setError((err as Error).message || "setting up kraftwerk sync failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sync-setup flex flex-col gap-2 border-t border-line bg-surface-2 px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <strong className="text-sm">Sync with kraftwerk cloud</strong>
          <div className={NOTE}>
            {ready
              ? "One click: the workspace gets its repository in kraftwerk cloud and kraftwerk sync turns on — every minute what changed here goes up and the others' changes come in. This machine signs in with its own key — no token, no git provider."
              : "kraftwerk sync comes with cloud mode: switch the workspace to cloud (below), then set it up here in one click. Or turn git sync on and use a remote of your own (expert mode)."}
          </div>
        </div>
        {ready ? (
          <Button size="sm" variant="primary" icon="cloud_upload" busy={busy} disabled={busy} onClick={() => void run()}>
            set up kraftwerk sync
          </Button>
        ) : (
          <a className="text-sm font-semibold" href="#/settings/cloud">
            what cloud mode is →
          </a>
        )}
      </div>
      {done.length > 0 && (
        <ul className={cn(NOTE, "m-0 list-none p-0")}>
          {done.map((d) => (
            <li key={d} className="inline-flex items-center gap-1 pr-3 text-ok">
              <Icon name="check" className="ms-sm" /> {d}
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

/** One file line in a panel; hairlines between them. */
const ROW = "flex flex-wrap items-center gap-2.5 py-2 [&+&]:border-t [&+&]:border-line";
const PATH = "truncate font-mono text-[12.5px]";
