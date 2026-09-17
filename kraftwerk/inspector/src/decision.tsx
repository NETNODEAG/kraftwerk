import { useState } from "react";
import type { DecisionView } from "./types";
import { fmtWhen } from "./shared";

/**
 * The form for a decision a step asked for (decision-request.json in the
 * run folder): one choice among the offered options, a note, one submit.
 * Once answered the panel shows what was decided — the answer is a file in
 * the run, so it stays. This is the manual way to give a run feedback,
 * next to the run's chat; nothing here is agent-driven.
 */
export function DecisionPanel({ runId, decision }: { runId: string; decision: DecisionView }) {
  const { request, answer } = decision;
  const [choice, setChoice] = useState<string | null>(request.options.length === 1 ? request.options[0].value : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelOf = (v: string) => request.options.find((o) => o.value === v)?.label ?? v;

  if (answer) {
    return (
      <section className="panel decision-panel is-decided" aria-label="decision">
        <div className="decision-body">
          <div className="decision-title">{request.title ?? "Decision"}</div>
          <div className="decision-answer">
            <span className="chip status ok">{labelOf(answer.decision)}</span>
            {answer.note && <span className="decision-note">“{answer.note}”</span>}
            {answer.decidedAt && <span className="decision-when num">{fmtWhen(answer.decidedAt)}</span>}
          </div>
        </div>
      </section>
    );
  }

  const canSubmit = !!choice && !busy && (request.note !== "required" || !!note.trim());

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: choice, note: note.trim() }),
    }).catch(() => null);
    // On success the run poll brings the answer back and this renders as decided.
    if (r?.ok) return;
    setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "could not save the decision");
    setBusy(false);
  }

  return (
    <section className="panel decision-panel" aria-label="decision needed">
      <div className="decision-body">
        <div className="decision-head">
          <span className="lamp running" />
          <div className="decision-title">{request.title ?? "This run needs your decision"}</div>
        </div>
        {request.prompt && <p className="decision-prompt">{request.prompt}</p>}
        <div className="tabs decision-options" role="radiogroup" aria-label="options">
          {request.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={choice === o.value}
              className={choice === o.value ? "active" : ""}
              onClick={() => setChoice(o.value)}
            >
              {o.label ?? o.value}
            </button>
          ))}
        </div>
        {request.note !== false && (
          <label className="m3-field">
            <input
              type="text"
              value={note}
              placeholder=" "
              aria-label="note"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <span className="m3-field-label">{request.note === "required" ? "Note (required)" : "Note"}</span>
          </label>
        )}
        {error && <div className="m3-error">{error}</div>}
        <div className="m3-actions">
          <button className="m3-filled-btn" onClick={submit} disabled={!canSubmit}>
            {busy ? "Saving…" : "Submit decision"}
          </button>
        </div>
      </div>
    </section>
  );
}
