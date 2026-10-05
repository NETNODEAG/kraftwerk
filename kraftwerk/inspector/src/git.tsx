import { useCallback, useRef, useEffect, useState } from "react";
import { fmtAgo, Icon, post } from "./shared";
import { Button, cn, EmptyState, Notice, Page, PageHeader, Panel, TextField } from "./ui";
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
  [/^(\+\+\+|---|diff |index )/, "text-fg-2 opacity-80"],
  [/^@@/, "text-accent"],
  [/^\+/, "text-ok"],
  [/^-/, "text-bad"],
];
const lineClass = (line: string): string => LINE_CLASSES.find(([re]) => re.test(line))?.[1] ?? "";

/** The workspace repo's diff of one changed file. */
function Diff({ file }: { file: string }) {
  return <DiffView url={`/api/git/diff?path=${encodeURIComponent(file)}`} />;
}

/** Unified diff from any endpoint that answers a GitDiff, coloured per line. Small enough not to warrant a library. */
export function DiffView({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setText(null);
    setError("");
    fetch(url)
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
  }, [url]);

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
      const r = await fetch(first.current ? "/api/git?fresh=1" : "/api/git", { cache: "no-store" });
      first.current = false;
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

  if (!st) return <EmptyState>loading…</EmptyState>;

  if (!st.enabled) {
    return (
      <Page>
        <PageHeader icon="cloud_sync" title="Git sync" />
        <Panel>
          <p className={PANEL_EMPTY}>
            Git sync is off. Turn it on in <a href="#/settings">settings</a>, or add a <code>git:</code> block to kraftwerk.yml.
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

      <p className={cn(NOTE, "m-0")}>
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
    </Page>
  );
}

/** One file line in a panel; hairlines between them. */
const ROW = "flex flex-wrap items-center gap-2.5 py-2 [&+&]:border-t [&+&]:border-line";
const PATH = "truncate font-mono text-[12.5px]";
