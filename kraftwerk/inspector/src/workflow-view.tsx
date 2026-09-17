import { useState } from "react";
import type { WorkflowDetail, AgentInfo, StepInfo, RunListItem } from "./types";
import { Link, usePoll, fmtDuration, fmtCost, fmtWhen, Lamp, Elapsed, StatusWord } from "./shared";
import { RunForm } from "./run-launcher";
import { WorkflowBoard } from "./workflow-board";

export type WorkflowTab = "overview" | "details" | "runs";

/**
 * One workflow, three tabs on their own routes: overview (trigger + board —
 * what to act on), details (agents, pipeline, folder — how it is built),
 * runs (every run of this workflow, newest first).
 */
export function WorkflowView({ slug, tab }: { slug: string; tab: WorkflowTab }) {
  const wf = usePoll<WorkflowDetail>(`/api/workflows/${encodeURIComponent(slug)}`, false);
  // A launch from this page stays here; the poll tightens until the new
  // run is on the board (and stays tight while any run of this workflow is live).
  const [launchedAt, setLaunchedAt] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const runsData = usePoll<{ runs: RunListItem[] }>("/api/runs", liveCount > 0 || Date.now() - launchedAt < 20_000);

  if (!wf) return <div className="empty">loading…</div>;
  if (wf.error) {
    return (
      <>
        <Crumbs slug={wf.slug} />
        <div className="empty">
          <span className="status-word failed">broken workflow</span>
          <pre style={{ marginTop: 12, textAlign: "left" }}>{wf.error}</pre>
        </div>
      </>
    );
  }

  const agentIdx = new Map(wf.agents.map((a, i) => [a.id, i % 4]));
  const runs = (runsData?.runs ?? []).filter((r) => r.workflow === wf.name || r.workflow === wf.slug);
  const base = `/workflows/${encodeURIComponent(wf.slug)}`;
  const live = runs.filter((r) => r.status === "running").length;
  if (live !== liveCount) setLiveCount(live);

  return (
    <>
      <Crumbs slug={wf.slug} />

      <div className="detail-head">
        <h1>{wf.name ?? wf.slug}</h1>
        <span className="rid mono">{wf.dir}</span>
        <span className="spacer" />
        <nav className="tabs" aria-label="workflow sections">
          <Link href={base} className={tab === "overview" ? "active" : ""}>overview</Link>
          <Link href={`${base}/details`} className={tab === "details" ? "active" : ""}>details</Link>
          <Link href={`${base}/runs`} className={tab === "runs" ? "active" : ""}>
            runs <span className="num">({runs.length})</span>
          </Link>
        </nav>
      </div>
      {wf.description && <p className="detail-req">{wf.description}</p>}

      {tab === "overview" && (
        <>
          <section className="panel run-panel" style={{ marginBottom: 18 }}>
            <RunForm
              slug={wf.slug}
              usesRequest={wf.usesRequest}
              initialRequest={runs[0]?.request}
              onLaunched={() => setLaunchedAt(Date.now())}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="microlabel">
                board{" "}
                <span className="num">
                  ({runs.length} runs{live > 0 ? `, ${live} live` : ""})
                </span>
              </span>
              <span className="spacer" />
              {runs[0] && (
                <Link href={`${base}/runs`} className="open-raw">
                  all runs ↗
                </Link>
              )}
            </div>
            <WorkflowBoard wf={wf} runs={runs} agentIdx={agentIdx} runsHref={`${base}/runs`} />
          </section>
        </>
      )}

      {tab === "details" && <Details wf={wf} agentIdx={agentIdx} />}

      {tab === "runs" && <RunList runs={runs} />}
    </>
  );
}

function Details({ wf, agentIdx }: { wf: WorkflowDetail; agentIdx: Map<string, number> }) {
  return (
    <>
      <div className="statgrid">
        <div className="stat">
          <div className="microlabel">agents</div>
          <div className="v num">{wf.agents.length}</div>
        </div>
        <div className="stat">
          <div className="microlabel">steps</div>
          <div className="v num">
            {wf.steps.length}{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              ({wf.steps.filter((s) => s.kind === "agent").length} agent ·{" "}
              {wf.steps.filter((s) => s.kind === "script").length} script)
            </span>
          </div>
        </div>
        {wf.workspace && (
          <div className="stat" style={{ maxWidth: 420 }}>
            <div className="microlabel">workspace</div>
            <div className="wf-workspace mono">{wf.workspace}</div>
          </div>
        )}
      </div>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="microlabel">agents</span>
        </div>
        <div className="agent-grid">
          {wf.agents.map((a) => (
            <AgentCard key={a.id} a={a} idx={agentIdx.get(a.id) ?? 0} />
          ))}
          {wf.agents.length === 0 && <div className="viewer-note">no agents — script-only workflow</div>}
        </div>
      </section>

      <div className="columns">
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">pipeline</span>
          </div>
          <div className="pipeline">
            {wf.steps.map((s, i) => (
              <StepNode key={s.name} s={s} i={i} idx={s.agent ? agentIdx.get(s.agent) ?? 0 : null} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">
              folder <span className="num">({wf.files.length} files)</span>
            </span>
          </div>
          <div className="file-list">
            {wf.files.map((f) => (
              <div key={f} className="file-row" style={{ cursor: "default" }}>
                <span className="fname">{f}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/** Every run of the workflow, newest first — the board's cards as a flat list. */
function RunList({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) return <div className="empty">no runs of this workflow yet</div>;
  return (
    <div className="run-list">
      {runs.map((r) => {
        const total = r.phasesTotal ?? 0;
        const pct = total > 0 ? Math.round((r.phasesDone / total) * 100) : r.status === "ok" ? 100 : 0;
        return (
          <Link key={r.id} href={`/runs/${r.id}`} className={`run-card is-${r.status}`}>
            <Lamp status={r.status} />
            <span className="rid">{r.id.replace(/^run-/, "")}</span>
            <span className="req" title={r.request}>
              {r.status === "running" && r.currentPhase ? r.currentPhase : (r.request ?? "")}
            </span>
            <span className="meta">
              {r.awaitingDecision && <span className="chip decision">decision needed</span>}
              <StatusWord status={r.status} />
              <span className="progress-track" title={`${r.phasesDone}${total ? ` / ${total}` : ""} steps`}>
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className="num">{r.status === "running" ? <Elapsed since={r.startedAt} /> : fmtDuration(r.durationMs)}</span>
              <span className="num">{fmtCost(r.costUsd)}</span>
              <span className="num">{fmtWhen(r.startedAt)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Crumbs({ slug }: { slug: string }) {
  return (
    <nav className="crumbs">
      <Link href="/workflows">workflows</Link>
      <span className="sep">/</span>
      <span className="mono">{slug}</span>
    </nav>
  );
}

function AgentCard({ a, idx }: { a: AgentInfo; idx: number }) {
  return (
    <div className={`agent-card aid-${idx}`}>
      <div className="agent-head">
        <span className="agent-dot" />
        <b>{a.name ?? a.id}</b>
        <code className="agent-id">[{a.id}]</code>
        <span className="spacer" />
        <span className="chip">
          {a.model ?? "default"}
          {a.effort ? ` · ${a.effort}` : ""}
          {a.protocol === "acp" ? " · acp" : ""}
        </span>
      </div>
      {a.tools.length > 0 && (
        <div className="agent-tools">
          {a.tools.map((t) => (
            <span key={t} className="tool-chip">{t}</span>
          ))}
        </div>
      )}
      {a.persona && <p className="agent-persona">{a.persona}</p>}
    </div>
  );
}

function StepNode({ s, i, idx }: { s: StepInfo; i: number; idx: number | null }) {
  const body = s.kind === "script" ? s.script : s.prompt;
  return (
    <div className="step-node">
      <div className={`step-index num ${idx != null ? `aid-${idx}` : "is-script"}`}>{i + 1}</div>
      <div className="step-body">
        <div className="phase-top">
          <span className="phase-name">{s.name}</span>
          {s.kind === "agent" ? (
            <span className={`chip agent-chip aid-${idx ?? 0}`}>agent · {s.agent}</span>
          ) : (
            <span className="chip">script{s.sourceRef ? ` · ${s.sourceRef}` : ""}</span>
          )}
        </div>
        {body && (
          <details className="step-source">
            <summary>{s.kind === "agent" ? "prompt" : "script"}</summary>
            <pre>{body}</pre>
          </details>
        )}
        {s.gates.length > 0 && (
          <div className="gate-line">
            {s.gates.map((g) => (
              <span key={g} className="gate neutral">⛨ {g}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
