import { useEffect, useState } from "react";
import {
  listWorkflows,
  runWorkflow,
  sandboxReady,
  type RunListItem,
  type WorkflowSummary,
} from "./api";
import { EditIcon, PlayIcon, RunsIcon } from "./icons";
import { useMenu } from "./menu";
import { Modal } from "./modal";
import { AddWorkflowModal, WorkflowModal } from "./workflow-modal";
import { runLine, type UiRun } from "./runs";

/** "14:32" for today, "12 Sep" before. */
const when = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** The third button of a card: this workflow's runs, newest first; one opens its details. */
function RunsMenu({ name, runs, onOpenRun }: { name: string; runs: RunListItem[]; onOpenRun: (id: string) => void }) {
  const { open, setOpen, wrap } = useMenu<HTMLDivElement>();
  // The card has no status line: the button carries a dot while the newest run
  // wants a look (working, waiting for a person, failed) and none once it is done.
  const newest = runs[0] ? runLine(runs[0]) : null;
  const flag = newest && newest.tone !== "ok" ? newest : null;
  return (
    <div className="menu menu-right" ref={wrap}>
      <button
        className="icon"
        title={flag ? `Runs — newest: ${flag.text}` : "Runs"}
        aria-label={flag ? `Runs of ${name} — newest: ${flag.text}` : `Runs of ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <RunsIcon />
        {flag && <span className={`icon-flag tone-${flag.tone}`} aria-hidden />}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {runs.length === 0 && <div className="switcher-empty">No runs yet.</div>}
          {runs.slice(0, 30).map((r) => {
            const line = runLine(r);
            return (
              <button
                key={r.id}
                className={`menu-item tone-${line.tone}`}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenRun(r.id);
                }}
              >
                <span className="wf-run-dot" aria-hidden />
                <span className="menu-text">
                  <span className="menu-name">{r.request?.replace(/\s+/g, " ") || "(no request)"}</span>
                  <span className="menu-sub">
                    {line.text} · {when(r.startedAt ?? r.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
          {runs.length > 30 && <div className="switcher-empty">Older runs are in the inspector.</div>}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ workflow, sandbox, runs, onLaunched, onEdit, onOpenRun }: {
  workflow: WorkflowSummary;
  sandbox: boolean;
  /** This workflow's runs, newest first. */
  runs: RunListItem[];
  onOpenRun: (id: string) => void;
  onLaunched: (run: UiRun) => void;
  /** The change asked for in the workflow's modal, in the user's words. */
  onEdit: (change: string) => void;
}) {
  const [editing, setEditing] = useState(false);
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


  return (
    <li className="wf">
      <div className="wf-head">
        <h3>{workflow.name || workflow.slug}</h3>
        <div className="wf-actions">
          <RunsMenu name={workflow.name || workflow.slug} runs={runs} onOpenRun={onOpenRun} />
          <button className="icon" title="Edit" aria-label={`Edit ${workflow.name || workflow.slug}`} onClick={() => setEditing(true)}>
            <EditIcon />
          </button>
          {!workflow.error && (
            <button
              className="icon icon-primary"
              title={workflow.usesRequest ? "Run…" : "Run"}
              aria-label={`Run ${workflow.name || workflow.slug}`}
              disabled={busy}
              onClick={() => {
                setError("");
                if (workflow.usesRequest) setAsking(true);
                else void launch();
              }}
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
        <Modal
          title={`Run ${workflow.name || workflow.slug}`}
          onClose={() => setAsking(false)}
          onSubmit={() => request.trim() && !busy && void launch()}
          footer={
            <>
              <button type="button" className="quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || !request.trim()}>
                {busy ? "Starting…" : "Run"}
              </button>
            </>
          }
        >
          <div className="modal-fields">
            {workflow.description && <p className="wf-desc">{workflow.description}</p>}
            <label className="field">
              <span>What should it work on?</span>
              <p className="field-hint">A URL, a topic, a text — whatever this workflow takes. You can follow the run in the chat.</p>
              <textarea
                autoFocus
                rows={4}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim() && !busy) void launch();
                }}
              />
            </label>
            {error && (
              <p className="panel-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}

      {error && !asking && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}

      {editing && (
        <WorkflowModal
          workflow={workflow}
          onClose={() => setEditing(false)}
          onRequestChange={(change) => {
            setEditing(false);
            onEdit(change);
          }}
        />
      )}

    </li>
  );
}

export function Workflows({ runs, onLaunched, onEdit, onAdd, onOpenRun }: {
  runs: RunListItem[];
  onOpenRun: (id: string) => void;
  onLaunched: (run: UiRun) => void;
  /** A change asked for in a workflow's modal: its name, its absolute folder, the change in words. */
  onEdit: (name: string, folder: string, change: string) => void;
  /** A new workflow asked for in words, and the absolute folder the workflows live in. */
  onAdd: (spec: string, root: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [root, setRoot] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [error, setError] = useState("");

  // Workflows are added and changed by an agent in the chat, outside this
  // component: the list is read again every so often and when the window is
  // looked at again, so a new one appears without a reload.
  useEffect(() => {
    let alive = true;
    const load = () =>
      listWorkflows()
        .then(({ root, workflows: w }) => {
          if (!alive) return;
          setWorkflows(w);
          setRoot(root ?? "");
          setError("");
        })
        .catch((err: Error) => alive && setError(err.message));
    void load();
    const timer = setInterval(load, 15_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  // No usable sandbox means a local run, as in the inspector — the play button is never dead on arrival.
  const first = workflows?.[0]?.slug;
  useEffect(() => {
    let alive = true;
    if (first) void sandboxReady(first).then((ok) => alive && setSandbox(ok));
    return () => {
      alive = false;
    };
  }, [first]);

  return (
    <>
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
      <ul className="wf-list">
        <li>
          <button className="add-card" onClick={() => setAdding(true)}>
            <span aria-hidden>＋</span> Add workflow
          </button>
        </li>
        {workflows?.map((w) => (
          <WorkflowCard
            key={w.slug}
            workflow={w}
            sandbox={sandbox}
            // Runs come newest first; a run knows its workflow by name.
            runs={runs.filter((r) => r.workflow === (w.name || w.slug))}
            onOpenRun={onOpenRun}
            onLaunched={onLaunched}
            onEdit={(change) => onEdit(w.name || w.slug, root ? `${root}/${w.slug}` : w.slug, change)}
          />
        ))}
        {workflows?.length === 0 && <li className="panel-empty">This workspace has no workflows yet.</li>}
      </ul>
      {adding && (
        <AddWorkflowModal
          onClose={() => setAdding(false)}
          onRequest={(spec) => {
            setAdding(false);
            onAdd(spec, root);
          }}
        />
      )}
    </>
  );
}
