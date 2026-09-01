import { useEffect, useState } from "react";
import type { WorkflowDetail, AgentInfo, StepInfo, RunListItem } from "./types";
import { Icon, Link, navigate, usePoll, fmtDuration, fmtCost, fmtWhen, Lamp } from "./shared";

export function WorkflowView({ slug }: { slug: string }) {
  const wf = usePoll<WorkflowDetail>(`/api/workflows/${encodeURIComponent(slug)}`, false);
  const runsData = usePoll<{ runs: RunListItem[] }>("/api/runs", false);

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
  const runs = (runsData?.runs ?? []).filter((r) => r.workflow === wf.name).slice(0, 8);

  return (
    <>
      <Crumbs slug={wf.slug} />

      <div className="detail-head">
        <h1>{wf.name ?? wf.slug}</h1>
        <span className="rid mono">{wf.dir}</span>
      </div>
      {wf.description && <p className="detail-req">{wf.description}</p>}

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

      <RunPanel slug={wf.slug} lastRequest={runs[0]?.request} />

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

        <div style={{ display: "grid", gap: 18 }}>
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

          <section className="panel">
            <div className="panel-head">
              <span className="microlabel">
                recent runs <span className="num">({runs.length})</span>
              </span>
            </div>
            <div className="file-list">
              {runs.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="file-row">
                  <Lamp status={r.status} />
                  <span className="fname">{r.id.replace(/^run-/, "")}</span>
                  <span className="fsize num">
                    {fmtDuration(r.durationMs)} · {fmtCost(r.costUsd)} · {fmtWhen(r.startedAt)}
                  </span>
                </Link>
              ))}
              {runs.length === 0 && <div className="viewer-note">no runs of this workflow yet</div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function RunPanel({ slug, lastRequest }: { slug: string; lastRequest?: string }) {
  const [request, setRequest] = useState("");
  const [sandbox, setSandbox] = useState(true);
  const [ssh, setSsh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docker = usePoll<{ available: boolean; image: boolean }>(
    `/api/workflows/${encodeURIComponent(slug)}/run`,
    false
  );

  useEffect(() => {
    if (!request && lastRequest) setRequest(lastRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRequest]);

  const sandboxReady = docker?.available && docker?.image;
  const sandboxHint = !docker
    ? ""
    : !docker.available
      ? "Docker not running — sandbox unavailable"
      : !docker.image
        ? "image missing — run `kraftwerk runner build`"
        : "isolated container per run";

  async function launch() {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(slug)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.trim(), sandbox, ssh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      navigate(`/runs/${data.runId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="panel run-panel" style={{ marginBottom: 18 }}>
      <div className="panel-head">
        <span className="microlabel">trigger run</span>
      </div>
      <div className="run-form">
        <input
          type="text"
          value={request}
          placeholder="request — topic, URL, host …"
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && launch()}
        />
        <button className="run-btn" onClick={launch} disabled={busy || !request.trim() || (sandbox && !sandboxReady)}>
          {busy ? "starting…" : <><Icon name="play_arrow" className="ms-sm" /> {sandbox ? "run in sandbox" : "run locally"}</>}
        </button>
      </div>
      <div className="run-opts">
        <label>
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
          docker sandbox {sandboxHint && <span className="opt-hint">— {sandboxHint}</span>}
        </label>
        <label>
          <input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} disabled={!sandbox} />
          forward SSH agent
        </label>
      </div>
      {error && <div className="gate-fail-msg">{error}</div>}
    </section>
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
