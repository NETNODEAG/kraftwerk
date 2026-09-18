import { useEffect, useState } from "react";
import {
  inspectorUrl,
  listWorkflows,
  runWorkflow,
  sandboxReady,
  type RunListItem,
  type WorkflowSummary,
} from "./api";
import { runLine, type UiRun } from "./runs";

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
  </svg>
);

const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z" />
    <path d="m14.5 7.5 3 3" />
  </svg>
);

function WorkflowCard({ workflow, sandbox, lastRun, onLaunched, onEdit }: {
  workflow: WorkflowSummary;
  sandbox: boolean;
  lastRun?: RunListItem;
  onLaunched: (run: UiRun) => void;
  onEdit: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const launch = async () => {
    setBusy(true);
    setError("");
    try {
      const { runId } = await runWorkflow(workflow.slug, { request: request.trim(), sandbox });
      onLaunched({ id: runId, workflow: workflow.name || workflow.slug, request: request.trim(), at: Date.now() });
      setAsking(false);
      setRequest("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = lastRun && runLine(lastRun);

  return (
    <li className="wf">
      <div className="wf-head">
        <h3>{workflow.name || workflow.slug}</h3>
        <div className="wf-actions">
          <button className="icon" title="Edit in the chat" aria-label={`Edit ${workflow.name || workflow.slug} in the chat`} onClick={onEdit}>
            <EditIcon />
          </button>
          {!workflow.error && !asking && (
            <button
              className="icon icon-primary"
              title={workflow.usesRequest ? "Run…" : "Run"}
              aria-label={`Run ${workflow.name || workflow.slug}`}
              disabled={busy}
              onClick={() => (workflow.usesRequest ? setAsking(true) : void launch())}
            >
              <PlayIcon />
            </button>
          )}
        </div>
      </div>

      {workflow.error ? (
        <p className="wf-broken">This workflow cannot run: {workflow.error}</p>
      ) : (
        workflow.description && <p className="wf-desc">{workflow.description}</p>
      )}

      {asking && (
        <form
          className="wf-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (request.trim()) void launch();
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={request}
            placeholder="What should it work on? (a URL, a topic, a text …)"
            aria-label={`Request for ${workflow.name || workflow.slug}`}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAsking(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim()) void launch();
            }}
          />
          <div className="wf-ask-actions">
            <button type="button" className="quiet" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !request.trim()}>
              {busy ? "Starting…" : "Run"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}

      {status && lastRun && (
        <a className={`wf-run tone-${status.tone}`} href={inspectorUrl(`/runs/${lastRun.id}`)} target="_blank" rel="noreferrer">
          <span className="wf-run-dot" aria-hidden />
          Last run: {status.text}
          <span className="wf-run-open">open</span>
        </a>
      )}
    </li>
  );
}

export function Workflows({ runs, onLaunched, onEdit }: {
  runs: RunListItem[];
  onLaunched: (run: UiRun) => void;
  /** Editing happens in the chat: hands over the workflow's name and its absolute folder. */
  onEdit: (name: string, folder: string) => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [root, setRoot] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    listWorkflows()
      .then(({ root, workflows: w }) => {
        if (!alive) return;
        setWorkflows(w);
        setRoot(root ?? "");
        // No usable sandbox means a local run, as in the inspector — Run! is never dead on arrival.
        if (w[0]) void sandboxReady(w[0].slug).then((ok) => alive && setSandbox(ok));
      })
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="panel workflows" aria-label="Workflows">
      <header className="panel-head">
        <h2>Workflows</h2>
      </header>
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
      {workflows?.length === 0 && <p className="panel-empty">This workspace has no workflows yet.</p>}
      <ul className="wf-list">
        {workflows?.map((w) => (
          <WorkflowCard
            key={w.slug}
            workflow={w}
            sandbox={sandbox}
            // Runs come newest first; a run knows its workflow by name.
            lastRun={runs.find((r) => r.workflow === (w.name || w.slug))}
            onLaunched={onLaunched}
            onEdit={() => onEdit(w.name || w.slug, root ? `${root}/${w.slug}` : w.slug)}
          />
        ))}
      </ul>
    </section>
  );
}
