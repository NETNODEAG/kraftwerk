import { useEffect, useState } from "react";
import { answerDecision, getRun, inspectorUrl, runFileUrl, type RunDecision, type RunDetail, type RunPhase } from "./api";
import { Modal } from "./modal";
import { runLine } from "./runs";

const duration = (ms?: number): string =>
  ms === undefined ? "" : ms < 1_000 ? "under a second" : ms < 60_000 ? `${Math.round(ms / 1_000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`;

const started = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

const PHASE: Record<RunPhase["status"], { text: string; tone: "live" | "ok" | "bad" | "muted" }> = {
  running: { text: "working…", tone: "live" },
  ok: { text: "done", tone: "ok" },
  failed: { text: "failed", tone: "bad" },
  blocked: { text: "stopped by the agent", tone: "bad" },
  pending: { text: "not started", tone: "muted" },
  skipped: { text: "skipped — nothing to do", tone: "muted" },
};

/** The form a waiting step asks a person for. The answer is written once, by the click. */
function Decision({ runId, decision, onAnswered }: { runId: string; decision: RunDecision; onAnswered: () => void }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const { request, answer } = decision;

  if (answer) {
    const label = request.options.find((o) => o.value === answer.decision)?.label ?? answer.decision;
    return (
      <div className="field">
        <span>{request.title || "Decision"}</span>
        <p className="field-hint">
          Decided: <strong>{label}</strong>
          {answer.note ? ` — "${answer.note}"` : ""} · {started(answer.decidedAt)}
        </p>
      </div>
    );
  }

  const decide = async (value: string) => {
    setSending(true);
    setError("");
    try {
      await answerDecision(runId, value, note);
      onAnswered();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  };

  return (
    <div className="decision">
      <div className="card-title">This run waits for your decision</div>
      {request.title && <strong>{request.title}</strong>}
      {request.prompt && <p>{request.prompt}</p>}
      {request.note !== false && (
        <label className="field">
          <span>Note{request.note === "required" ? "" : " (optional)"}</span>
          <textarea rows={2} value={note} placeholder="What the next step should know" onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <div className="card-actions">
        {request.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="primary"
            disabled={sending || (request.note === "required" && !note.trim())}
            onClick={() => void decide(o.value)}
          >
            {o.label ?? o.value}
          </button>
        ))}
      </div>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** One run: how far it got step by step, what it produced, and the decision it may be waiting for. */
export function RunModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  // Followed while it is live, so the modal is a place to watch a run too.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await getRun(runId);
        if (!alive) return;
        setRun(next);
        if (next.status === "running") timer = setTimeout(load, 2_000);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, version]);

  const line = run && runLine(run);
  // The bookkeeping files of a run are not what it produced.
  const results = run?.files.filter((f) => !["trace.jsonl", "trigger.json", "decision-request.json"].includes(f.name)) ?? [];

  return (
    <Modal
      title={run?.workflow ? `Run of ${run.workflow}` : "Run"}
      onClose={onClose}
      footer={
        <>
          <a className="modal-link" href={inspectorUrl(`/runs/${runId}`)} target="_blank" rel="noreferrer">
            Full trace in the inspector
          </a>
          <button type="button" className="quiet" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="modal-fields">
        {error && (
          <p className="panel-error" role="alert">
            {error}
          </p>
        )}
        {!run && !error && <p className="field-hint">Loading…</p>}

        {run && line && (
          <>
            <p className={`run-status tone-${line.tone}`}>
              <span className="wf-run-dot" aria-hidden />
              <strong>{line.text}</strong>
              <span className="field-hint">
                {[started(run.startedAt), duration(run.durationMs)].filter(Boolean).join(" · ")}
              </span>
            </p>

            {run.request && (
              <div className="field">
                <span>Request</span>
                <p className="run-request">{run.request}</p>
              </div>
            )}

            {run.decision && <Decision runId={runId} decision={run.decision} onAnswered={() => setVersion((v) => v + 1)} />}

            <div className="field">
              <span>Steps</span>
              <ol className="steps">
                {run.phases.map((p, i) => {
                  const state = PHASE[p.status] ?? PHASE.pending;
                  const failed = p.gates.filter((g) => !g.passed);
                  const detail = p.summary || p.lastActivity || "";
                  return (
                    <li key={`${p.phase}-${i}`}>
                      <details open={p.status === "failed" || p.status === "blocked"}>
                        <summary>
                          <span className="step-n">{i + 1}</span>
                          <span className="step-name">{p.phase}</span>
                          <span className={`step-kind kn-tone tone-${state.tone}`}>
                            {state.text}
                            {p.attempts > 1 ? ` · ${p.attempts} attempts` : ""}
                            {p.durationMs !== undefined ? ` · ${duration(p.durationMs)}` : ""}
                          </span>
                        </summary>
                        <div className="run-phase">
                          {detail && <p>{detail}</p>}
                          {failed.map((g) => (
                            <p key={g.gate} className="wf-error">
                              Check failed — {g.gate}: {g.failure}
                            </p>
                          ))}
                          {p.status === "failed" && p.stderr?.trim() && <pre className="step-text">{p.stderr.trim().split("\n").slice(-12).join("\n")}</pre>}
                          {!detail && failed.length === 0 && <p className="field-hint">{p.kind === "agent" ? `Done by ${p.agent ?? "an agent"}.` : "Done by a script."}</p>}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="field">
              <span>Results</span>
              {results.length === 0 && <p className="field-hint">No files yet.</p>}
              <ul className="run-files">
                {results.map((f) => (
                  <li key={f.name}>
                    <a href={runFileUrl(runId, f.name)} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
