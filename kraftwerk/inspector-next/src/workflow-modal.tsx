import { useEffect, useState } from "react";
import { getWorkflow, type WorkflowDetail, type WorkflowSummary } from "./api";
import { Modal } from "./modal";

/**
 * A workflow's settings. Workflows are files and the API only reads them, so
 * this shows the workflow as it is on disk; a change is described in words
 * and handed to the chat, whose agent edits the files.
 */
export function WorkflowModal({ workflow, onClose, onRequestChange }: {
  workflow: WorkflowSummary;
  onClose: () => void;
  onRequestChange: (change: string) => void;
}) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [error, setError] = useState(workflow.error ?? "");
  const [change, setChange] = useState("");

  useEffect(() => {
    let alive = true;
    // A broken workflow answers with its error; the summary already carries it.
    getWorkflow(workflow.slug)
      .then((d) => alive && setDetail(d))
      .catch((err: Error) => alive && setError((prev) => prev || err.message));
    return () => {
      alive = false;
    };
  }, [workflow.slug]);

  return (
    <Modal
      title={workflow.name || workflow.slug}
      onClose={onClose}
      onSubmit={() => change.trim() && onRequestChange(change.trim())}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="primary" disabled={!change.trim()}>
            Request change
          </button>
        </>
      }
    >
      <div className="modal-fields">
        {workflow.description && <p className="wf-desc">{workflow.description}</p>}

        {error && (
          <p className="panel-error modal-error" role="alert">
            This workflow cannot run: {error}
          </p>
        )}

        {!detail && !error && <p className="field-hint">Loading…</p>}

        {detail && detail.steps.length > 0 && (
          <div className="field">
            <span>Steps</span>
            <ol className="steps">
              {detail.steps.map((s, i) => (
                <li key={s.name}>
                  <details>
                    <summary>
                      <span className="step-n">{i + 1}</span>
                      <span className="step-name">{s.name}</span>
                      <span className="step-kind">{s.kind === "agent" ? `AI · ${s.agent ?? "agent"}` : "script"}</span>
                    </summary>
                    <pre className="step-text">{(s.kind === "agent" ? s.prompt : s.script)?.trim() || "(empty)"}</pre>
                    {s.gates.length > 0 && <p className="field-hint">Checked afterwards: {s.gates.join(", ")}</p>}
                  </details>
                </li>
              ))}
            </ol>
          </div>
        )}

        <label className="field">
          <span>What should change?</span>
          <p className="field-hint">A workflow is a set of files. Describe the change and the open conversation makes it.</p>
          <textarea
            rows={3}
            value={change}
            autoFocus
            placeholder="e.g. Add a step that checks the page title length, and mention it in the report."
            onChange={(e) => setChange(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * A new workflow starts the way an edit does: described in words and handed
 * to the chat, whose agent builds the files (from kraftwerk's own build brief).
 */
export function AddWorkflowModal({ onClose, onRequest }: { onClose: () => void; onRequest: (spec: string) => void }) {
  const [spec, setSpec] = useState("");

  return (
    <Modal
      title="Add workflow"
      onClose={onClose}
      onSubmit={() => spec.trim() && onRequest(spec.trim())}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!spec.trim()}>
            Request workflow
          </button>
        </>
      }
    >
      <div className="modal-fields">
        <label className="field">
          <span>What should it do?</span>
          <p className="field-hint">
            Say what goes in, what should come out, and what has to be true of the result. The open conversation builds it and
            it shows up in this list.
          </p>
          <textarea
            rows={6}
            value={spec}
            autoFocus
            placeholder="e.g. Take a page URL, check its title, meta description and headings against our SEO guidelines, and write a short report with the three most important fixes."
            onChange={(e) => setSpec(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
