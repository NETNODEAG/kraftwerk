import { useEffect, useMemo, useState } from "react";
import type { RunListItem, WorkflowSummary } from "./types";
import { useApi } from "./api";
import { fmtAgo, navigate } from "./shared";
import { WORKFLOW_DELETED_EVENT, WorkflowView, type WorkflowTab } from "./workflow-view";
import { RunStatus, runTone } from "./runs";
import { Button, Dot, EmptyState, ListRow, SideHead, SideList, SideNote, SideSearch, Tag } from "./ui";

/**
 * Workflows, laid out like the knowledge page: the workflows in a sidebar
 * (lamp = last run, its count, a search), the selected one beside it with
 * its overview (request box + board), details and runs. A bare #/workflows
 * lands on the workflow that ran last. The runs screen lives under this one
 * (the side head's "runs"), not in the main navigation.
 */

interface RunStats {
  count: number;
  last?: RunListItem;
}

/** Runs carry the workflow *name*; slug is the fallback for traces without one. */
function runStats(runs: RunListItem[], w: WorkflowSummary): RunStats {
  const mine = runs.filter((r) => r.workflow === (w.name ?? w.slug));
  return { count: mine.length, last: mine[0] };
}

/** The runs screen opened on this workflow's latest run, sidebar filtered to it. */
export function runsHref(last: RunListItem, w: { name?: string; slug: string }): string {
  return `/runs/${last.id}?workflow=${encodeURIComponent(w.name ?? w.slug)}`;
}

export function WorkflowsScreen({ slug, tab }: { slug?: string; tab: WorkflowTab }) {
  // A delete drops the workflow at once and refetches the list (a changed refresh restarts the poll).
  const [gone, setGone] = useState<string[]>([]);
  useEffect(() => {
    const drop = (e: Event) => setGone((g) => [...g, (e as CustomEvent<string>).detail]);
    window.addEventListener(WORKFLOW_DELETED_EVENT, drop);
    return () => window.removeEventListener(WORKFLOW_DELETED_EVENT, drop);
  }, []);
  const data = useApi("workflows.list", {}, { refresh: gone.length });
  const runsData = useApi("runs.list", {});
  const [q, setQ] = useState("");

  const wfs = useMemo(() => (data?.workflows ?? []).filter((w) => !gone.includes(w.slug)), [data, gone]);
  const runs = runsData?.runs ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return wfs;
    return wfs.filter((w) => [w.name, w.slug, w.description].some((s) => s?.toLowerCase().includes(needle)));
  }, [wfs, q]);

  // A bare #/workflows lands on the workflow that ran last, else the first one
  // (like #/knowledge lands on the bundle touched last). Waits for the runs so
  // it does not jump twice.
  const landing = useMemo(() => {
    if (wfs.length === 0) return undefined;
    const ran = wfs
      .map((w) => ({ w, last: runStats(runs, w).last }))
      .filter((x): x is { w: WorkflowSummary; last: RunListItem } => !!x.last)
      .sort((a, b) => (b.last.updatedAt ?? "").localeCompare(a.last.updatedAt ?? ""));
    return (ran[0]?.w ?? wfs[0]).slug;
  }, [wfs, runs]);
  const runsLoaded = !!runsData;
  useEffect(() => {
    if (!slug && landing && runsLoaded) navigate(`/workflows/${encodeURIComponent(landing)}`, { replace: true });
  }, [slug, landing, runsLoaded]);

  return (
    <div className="runs-screen workflows-screen">
      <aside className="runs-side">
        <SideHead
          title="workflows"
          count={data ? wfs.length : undefined}
          action={
            <Button size="sm" variant="quiet" icon="history" href="/runs" title="every run of every workflow, newest first">
              runs <span className="tabular-nums">{runs.length}</span>
            </Button>
          }
        />
        {wfs.length > 0 && <SideSearch icon="search" value={q} placeholder="search workflows" aria-label="search workflows" onChange={(e) => setQ(e.target.value)} />}
        <SideList>
          {shown.map((w) => {
            const st = runStats(runs, w);
            return (
              <ListRow
                key={w.slug}
                className="wf-row"
                href={`/workflows/${encodeURIComponent(w.slug)}`}
                active={w.slug === slug}
                leading={<Dot tone={runTone(st.last?.status)} title={st.last?.status ?? "no runs yet"} />}
                title={w.name ?? w.slug}
                titleExtra={w.error && <Tag tone="bad">broken</Tag>}
                meta={st.last && fmtAgo(st.last.updatedAt)}
                sub={<span title={w.error ?? w.description ?? ""}>{w.error ?? w.description ?? `${w.agents} agents · ${w.steps} steps`}</span>}
                subTone={w.error ? "bad" : "plain"}
                actionsAlways
                actions={
                  st.last ? (
                    <button
                      type="button"
                      className="wf-runs inline-flex cursor-pointer items-center gap-1 rounded-control border-0 bg-transparent px-1.5 py-0.5 text-2xs tabular-nums text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                      title="show the runs of this workflow"
                      onClick={() => navigate(runsHref(st.last!, w))}
                    >
                      {st.count} {st.count === 1 ? "run" : "runs"} · <RunStatus status={st.last.status} />
                    </button>
                  ) : (
                    <span className="wf-runs px-1.5 text-2xs text-fg-2 opacity-80">no runs yet</span>
                  )
                }
              />
            );
          })}
          {data && wfs.length > 0 && shown.length === 0 && <SideNote className="wf-nomatch">no workflow matches “{q}”</SideNote>}
          {data && wfs.length === 0 && <SideNote>no workflows yet</SideNote>}
        </SideList>
      </aside>
      <div className="runs-main">
        {slug ? (
          <WorkflowView key={slug} slug={slug} tab={tab} />
        ) : data && wfs.length === 0 ? (
          <EmptyState icon="account_tree">
            No workflows found — expected <code>src/workflows/</code> or <code>workflows/</code> next to the output folder.
          </EmptyState>
        ) : (
          <EmptyState>loading…</EmptyState>
        )}
      </div>
    </div>
  );
}
