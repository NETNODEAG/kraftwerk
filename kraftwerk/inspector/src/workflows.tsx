import { useEffect, useMemo, useState } from "react";
import type { RunListItem, WorkflowSummary } from "./types";
import { Icon, Lamp, Link, StatusWord, fmtAgo, navigate, usePoll } from "./shared";
import { WorkflowView, type WorkflowTab } from "./workflow-view";

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
  const data = usePoll<{ root?: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const runsData = usePoll<{ runs: RunListItem[] }>("/api/runs", false);
  const [q, setQ] = useState("");

  const wfs = data?.workflows ?? [];
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
        <div className="side-head">
          <span className="microlabel">workflows</span>
          {data && <span className="microlabel num">{wfs.length}</span>}
          <span className="spacer" />
          <Link href="/runs" className="open-raw" title="every run of every workflow, newest first">
            <Icon name="history" className="ms-sm" /> runs <span className="num">{runs.length}</span>
          </Link>
        </div>
        {wfs.length > 0 && (
          <label className="side-filter">
            <Icon name="search" className="ms-sm" />
            <input type="search" value={q} placeholder="search workflows" aria-label="search workflows" onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        <div className="side-list">
          {shown.map((w) => {
            const st = runStats(runs, w);
            return (
              <Link key={w.slug} href={`/workflows/${encodeURIComponent(w.slug)}`} className={`side-row wf-row${w.slug === slug ? " active" : ""}`}>
                <Lamp status={st.last?.status ?? "idle"} />
                <div className="side-row-body">
                  <div className="side-row-top">
                    <span className="side-wf">{w.name ?? w.slug}</span>
                    {w.error && <span className="status-word failed">broken</span>}
                    {st.last && <span className="side-when num">{fmtAgo(st.last.updatedAt)}</span>}
                  </div>
                  <div className="side-row-sub">
                    <span className="side-req" title={w.error ?? w.description ?? ""}>
                      {w.error ?? w.description ?? `${w.agents} agents · ${w.steps} steps`}
                    </span>
                    {st.last ? (
                      <button
                        type="button"
                        className="wf-runs num"
                        title="show the runs of this workflow"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate(runsHref(st.last!, w));
                        }}
                      >
                        {st.count} {st.count === 1 ? "run" : "runs"} · <StatusWord status={st.last.status} />
                      </button>
                    ) : (
                      <span className="wf-runs none num">no runs yet</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
          {data && wfs.length > 0 && shown.length === 0 && <div className="viewer-note wf-nomatch">no workflow matches “{q}”</div>}
          {data && wfs.length === 0 && <div className="viewer-note">no workflows yet</div>}
        </div>
      </aside>
      <div className="runs-main">
        {slug ? (
          <WorkflowView key={slug} slug={slug} tab={tab} />
        ) : data && wfs.length === 0 ? (
          <div className="empty">
            No workflows found — expected <code>src/workflows/</code> or <code>workflows/</code> next to the output folder.
          </div>
        ) : (
          <div className="empty">loading…</div>
        )}
      </div>
    </div>
  );
}
