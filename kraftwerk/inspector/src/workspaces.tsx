import { useCallback, useEffect, useState } from "react";
import { fmtAgo, Icon, post, WorkspaceTile } from "./shared";
import { Button, buttonClass, cn, EmptyState, Notice, Page, PageHeader, Panel } from "./ui";

/**
 * Workspaces admin (#/workspaces, expert mode): every project this machine
 * ever ran the inspector for (~/.kraftwerk/workspaces), joined with what is
 * running now. Start a stopped one, stop a running one, and drop records
 * whose root no longer holds a kraftwerk.yml. Linked from the workspace
 * switcher popover.
 */

type State = "running" | "stopped" | "died" | "missing" | "orphaned";

interface Workspace {
  name: string;
  icon?: string;
  color?: string;
  named?: boolean;
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

/** The state word's colour, and how much a workspace that is not up fades. */
const STATE_TONE: Record<State, string> = {
  running: "text-ok",
  stopped: "text-fg-2",
  died: "text-ask",
  missing: "text-bad",
  orphaned: "text-bad",
};
const TILE_FADE: Record<State, string> = {
  running: "",
  stopped: "opacity-65 grayscale-50",
  died: "opacity-80",
  missing: "opacity-45 grayscale-80",
  orphaned: "opacity-45 grayscale-80",
};

export function WorkspacesScreen() {
  const [rows, setRows] = useState<Workspace[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({}); // key → verb in flight
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/workspaces", { cache: "no-store" });
      if (r.ok) {
        setRows((await r.json()) as Workspace[]);
        setLoadError("");
        return;
      }
      // 404 = this inspector predates the endpoint. Say so instead of
      // spinning on "loading…" forever.
      setLoadError(
        r.status === 404
          ? "This workspace runs a kraftwerk without the workspaces API. Update it and restart its UI."
          : `Could not load the workspace registry (HTTP ${r.status}).`
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
      const d = await post<{ url?: string; live?: boolean }>(`/api/workspaces/${verb}`, body);
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
  const iconCount = new Map<string, number>();
  for (const r of rows ?? []) if (r.icon) iconCount.set(r.icon, (iconCount.get(r.icon) ?? 0) + 1);
  const ambiguous = (i?: string) => !!i && (iconCount.get(i) ?? 0) > 1;

  return (
    <Page>
      <PageHeader
        icon={<Icon name="hub" className="text-[28px] text-fg-2" />}
        title="Workspaces"
        actions={
          <>
            {rows && (
              <span className="text-xs text-fg-2">
                {rows.length} known · {running} running
              </span>
            )}
            {rows && loadError && <Notice tone="bad">{loadError}</Notice>}
          </>
        }
      />

      <Panel
        title="workspaces on this machine"
        actions={
          <span className="text-xs text-fg-2">
            registry: <code className="text-2xs">~/.kraftwerk/workspaces</code>
          </span>
        }
      >
        {!rows && !loadError && <EmptyState className="py-6">loading…</EmptyState>}
        {!rows && loadError && (
          <div className="px-[18px] py-4">
            <Notice tone="bad">{loadError}</Notice>
          </div>
        )}
        {rows && rows.length === 0 && <EmptyState className="py-6">No workspaces known yet.</EmptyState>}
        {rows?.map((w) => {
          const key = keyOf(w);
          const verb = busy[key];
          const removable = !w.live && !!w.root && (w.exists === false || w.hasConfig === false);
          const nameCls = cn("text-md font-semibold text-fg", w.named === false && "italic text-fg-2");
          return (
            <div
              key={key}
              className={cn(
                "grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3.5 px-[18px] py-3.5 [&+&]:border-t [&+&]:border-line/55",
                w.state === "died" && "bg-ask-soft/30"
              )}
            >
              <WorkspaceTile className={cn("size-10", TILE_FADE[w.state])} icon={w.icon} name={w.name} color={w.color} seed={w.root ?? w.url} ambiguous={ambiguous(w.icon)} />
              <div className="flex min-w-0 flex-col gap-[3px]">
                <div className="flex flex-wrap items-center gap-2.5">
                  {w.live && !w.current ? (
                    <a href={w.url} className={cn(nameCls, "no-underline hover:underline")}>{w.name}</a>
                  ) : (
                    <span className={nameCls}>{w.name}</span>
                  )}
                  {w.current && <span className="text-[10.5px] font-semibold tracking-[0.4px] text-fg-2 uppercase">current</span>}
                  <span className={cn("inline-flex items-center gap-1.5 text-2xs font-semibold tracking-[0.4px] uppercase", STATE_TONE[w.state])}>
                    {w.live && <span className="inline-block size-2 rounded-full bg-ok" />}
                    {STATE_LABEL[w.state].label}
                  </span>
                  {STATE_LABEL[w.state].note && <span className="text-xs text-fg-2">{STATE_LABEL[w.state].note}</span>}
                </div>
                <div className="font-mono text-xs [overflow-wrap:anywhere] text-fg-2" title={w.root}>
                  {w.rootLabel ?? <span className="font-sans opacity-70">no root recorded (started by an older version)</span>}
                </div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg-2">
                  {w.state !== "missing" && w.state !== "orphaned" && <span>{w.url.replace(/^https?:\/\//, "")}</span>}
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
                {errors[key] && <Notice tone="bad">{errors[key]}</Notice>}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {w.live && !w.current && (
                  <a className={buttonClass("secondary", "sm")} href={w.url} title="Open this workspace">
                    <Icon name="open_in_new" className="ms-sm" /> open
                  </a>
                )}
                {!w.live && w.root && w.exists !== false && !w.dirGone && (
                  <Button size="sm" variant="primary" icon="play_arrow" busy={verb === "start"} disabled={!!verb} onClick={() => void act(w, "start")}>
                    {verb === "start" ? "starting…" : "start"}
                  </Button>
                )}
                {w.live && !w.current && (
                  <Button size="sm" variant="danger" icon="stop" busy={verb === "stop"} disabled={!!verb} onClick={() => void act(w, "stop")}>
                    {verb === "stop" ? "stopping…" : "stop"}
                  </Button>
                )}
                {removable && confirmRemove !== key && (
                  <Button size="sm" icon="delete" disabled={!!verb} title="Drop this project from the registry (files untouched)" onClick={() => setConfirmRemove(key)}>
                    remove
                  </Button>
                )}
                {removable && confirmRemove === key && (
                  <>
                    <Button size="sm" variant="danger" icon="delete" onClick={() => void act(w, "forget")}>
                      confirm remove
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(null)}>
                      cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Panel>

      <p className="m-0 text-xs text-fg-2 [&_code]:text-2xs">
        Start launches <code>kraftwerk ui</code> detached in the project root (log in <code>~/.kraftwerk/logs</code>).
        Stop sends SIGTERM to the running server. Remove is offered only for records whose root no
        longer holds a <code>kraftwerk.yml</code> — the same from the terminal:{" "}
        <code>kraftwerk workspaces</code>.
      </p>
    </Page>
  );
}
