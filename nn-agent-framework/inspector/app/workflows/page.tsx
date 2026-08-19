"use client";

import type { WorkflowSummary } from "@/lib/workflows";
import { usePoll } from "../shared";

export default function WorkflowIndex() {
  const data = usePoll<{ root?: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const wfs = data?.workflows ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Workflows</h1>
        <span className="count num">{wfs.length} discovered</span>
        {data?.root && <span className="count mono">{data.root}</span>}
      </div>

      {data && wfs.length === 0 && (
        <div className="empty">
          No workflows found — expected <code>src/workflows/</code> or <code>workflows/</code>{" "}
          next to the output folder.
        </div>
      )}

      <div className="wf-grid">
        {wfs.map((w) => (
          <a key={w.slug} href={`/workflows/${w.slug}`} className="wf-card">
            <div className="wf-card-head">
              <span className="wf-name">{w.name ?? w.slug}</span>
              {w.error && <span className="status-word failed">broken</span>}
            </div>
            <p className="wf-desc">{w.error ?? w.description ?? ""}</p>
            <div className="wf-meta num">
              <span>{w.agents} agents</span>
              <span>·</span>
              <span>{w.steps} steps</span>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
