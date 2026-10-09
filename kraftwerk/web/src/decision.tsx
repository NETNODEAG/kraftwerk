import { useState } from "react";
import type { DecisionView } from "./types";
import { api } from "./api";
import { fmtWhen } from "./shared";
import { Button, cn, Dot, Notice, Tag, TextField } from "./ui";

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
      <section className={cn(PANEL, "decision-panel is-decided")} aria-label="decision">
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className={TITLE}>{request.title ?? "Decision"}</div>
          <div className="flex flex-wrap items-center gap-3 text-base">
            <Tag tone="ok">{labelOf(answer.decision)}</Tag>
            {answer.note && <span className="text-fg-2">“{answer.note}”</span>}
            {answer.decidedAt && <span className="text-xs tabular-nums text-fg-2">{fmtWhen(answer.decidedAt)}</span>}
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
    const r = await api.request("runs.decide", { id: runId, body: { decision: choice, note: note.trim() } }).catch(() => null);
    // On success the run poll brings the answer back and this renders as decided.
    if (r?.ok) return;
    setError(r?.error ?? "could not save the decision");
    setBusy(false);
  }

  return (
    <section className={cn(PANEL, "decision-panel")} aria-label="decision needed">
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Dot tone="working" />
          <div className={TITLE}>{request.title ?? "This run needs your decision"}</div>
        </div>
        {request.prompt && <p className="m-0 max-w-[80ch] text-base text-fg-2">{request.prompt}</p>}
        <div className="flex flex-wrap gap-2 self-start" role="radiogroup" aria-label="options">
          {request.options.map((o) => (
            <Button
              key={o.value}
              role="radio"
              aria-checked={choice === o.value}
              variant={choice === o.value ? "primary" : "secondary"}
              onClick={() => setChoice(o.value)}
            >
              {o.label ?? o.value}
            </Button>
          ))}
        </div>
        {request.note !== false && (
          <TextField
            value={note}
            placeholder={request.note === "required" ? "Note (required)" : "Note"}
            aria-label="note"
            className="max-w-[60ch]"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={submit} disabled={!canSubmit} busy={busy}>
            {busy ? "Saving…" : "Submit decision"}
          </Button>
        </div>
      </div>
    </section>
  );
}

const PANEL = "mb-[18px] overflow-hidden rounded-card border border-line bg-surface";
const TITLE = "text-[16px] font-medium text-fg";
