import { useEffect, useMemo, useState } from "react";
import type { RunListItem, WorkflowSummary } from "./types";
import { Icon, Lamp, Link, StatusWord, fmtAgo, navigate, usePoll } from "./shared";
import { SwitchRow, launchRun, sandboxHint, sandboxReady, useDocker, useRunLauncher } from "./run-launcher";

/**
 * Workflows: one searchable list, a ▶ per row. A workflow whose steps read
 * `${{ request }}` opens a dialog (overview + request box); one that does
 * not starts straight away. Each row counts its runs and links to them —
 * the runs screen lives under this one, not in the main navigation.
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

export function WorkflowsScreen() {
  const data = usePoll<{ root?: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const runsData = usePoll<{ runs: RunListItem[] }>("/api/runs", false);
  const docker = useDocker();
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<WorkflowSummary | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wfs = data?.workflows ?? [];
  const runs = runsData?.runs ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return wfs;
    return wfs.filter((w) =>
      [w.name, w.slug, w.description].some((s) => s?.toLowerCase().includes(needle))
    );
  }, [wfs, q]);

  async function run(w: WorkflowSummary) {
    if (w.usesRequest) return setDialog(w);
    // No request to ask for: go. Sandbox when it is ready, else local —
    // the run page shows which it was.
    setStarting(w.slug);
    setError(null);
    try {
      const runId = await launchRun(w.slug, { request: "", sandbox: sandboxReady(docker), ssh: false });
      navigate(`/runs/${runId}`);
    } catch (err) {
      setError(`${w.name ?? w.slug}: ${(err as Error).message}`);
      setStarting(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Workflows</h1>
        <nav className="tabs" aria-label="workflows sections">
          <Link href="/workflows" className="active">workflows <span className="num">({wfs.length})</span></Link>
          <Link href="/runs">runs <span className="num">({runs.length})</span></Link>
        </nav>
        <span className="spacer" />
        <label className="wf-search">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            placeholder="search workflows"
            aria-label="search workflows"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {error && <div className="gate-fail-msg wf-error">{error}</div>}

      {data && wfs.length === 0 && (
        <div className="empty">
          No workflows found — expected <code>src/workflows/</code> or <code>workflows/</code>{" "}
          next to the output folder.
        </div>
      )}

      {wfs.length > 0 && (
        <div className="wf-list" role="list">
          {shown.map((w) => {
            const st = runStats(runs, w);
            return (
              <div key={w.slug} className="wf-row" role="listitem">
                <Lamp status={st.last?.status ?? "idle"} />
                <div className="wf-row-main">
                  <div className="wf-row-top">
                    <Link href={`/workflows/${encodeURIComponent(w.slug)}`} className="wf-name">
                      {w.name ?? w.slug}
                    </Link>
                    {w.error && <span className="status-word failed">broken</span>}
                    <span className="wf-meta num">
                      {w.agents} agents · {w.steps} steps{w.usesRequest ? "" : " · no request"}
                    </span>
                  </div>
                  <p className="wf-desc" title={w.error ?? w.description ?? ""}>{w.error ?? w.description ?? ""}</p>
                </div>
                {st.last ? (
                  <Link href={runsHref(st.last, w)} className="wf-runs" title="show the runs of this workflow">
                    <Icon name="history" className="ms-sm" />
                    <span className="num">{st.count} {st.count === 1 ? "run" : "runs"}</span>
                    <span className="wf-last">
                      · <StatusWord status={st.last.status} /> {fmtAgo(st.last.updatedAt)}
                    </span>
                  </Link>
                ) : (
                  <span className="wf-runs none num">no runs yet</span>
                )}
                <button
                  className="run-btn wf-run"
                  disabled={!!w.error || starting === w.slug}
                  title={w.usesRequest ? "run with a request…" : "run now"}
                  onClick={() => void run(w)}
                >
                  {starting === w.slug ? (
                    "starting…"
                  ) : (
                    <><Icon name="play_arrow" className="ms-sm" /> run{w.usesRequest ? "…" : ""}</>
                  )}
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <div className="viewer-note wf-nomatch">no workflow matches “{q}”</div>}
        </div>
      )}

      {dialog && (
        <RunDialog
          w={dialog}
          lastRequest={runStats(runs, dialog).last?.request}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/**
 * M3 basic dialog: headline, supporting text, one text field, the two
 * options as switch rows, actions bottom-right. Everything else about the
 * workflow lives on its page — the "details" link leads there.
 */
function RunDialog({ w, lastRequest, onClose }: { w: WorkflowSummary; lastRequest?: string; onClose: () => void }) {
  const l = useRunLauncher(w.slug, w.usesRequest, lastRequest);
  const name = w.name ?? w.slug;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m3-dialog" role="dialog" aria-label={`Run ${name}`} aria-describedby="run-dialog-desc">
        <h2 className="m3-headline">Run {name}</h2>
        <p className="m3-supporting" id="run-dialog-desc">
          {w.description && <>{w.description} </>}
          <span className="m3-facts num">
            {w.agents} agents · {w.steps} steps ·{" "}
            <Link href={`/workflows/${encodeURIComponent(w.slug)}`}>details</Link>
          </span>
        </p>

        <label className="m3-field">
          <input
            type="text"
            value={l.request}
            placeholder=" "
            autoFocus
            aria-label="request"
            onChange={(e) => l.setRequest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && l.launch()}
          />
          <span className="m3-field-label">Request</span>
          <span className="m3-field-support">What the workflow should work on — a topic, URL, host …</span>
        </label>

        <div className="m3-switches">
          <SwitchRow label="Run in Docker sandbox" hint={sandboxHint(l.docker)} checked={l.sandbox} onChange={l.setSandbox} />
          {l.sandbox && <SwitchRow label="Forward SSH agent" hint="keys and known hosts from this machine" checked={l.ssh} onChange={l.setSsh} />}
        </div>

        {l.error && <div className="m3-error">{l.error}</div>}

        <div className="m3-actions">
          <button className="m3-text-btn" onClick={onClose}>Cancel</button>
          <button className="m3-filled-btn" onClick={l.launch} disabled={!l.canRun}>
            {l.busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
