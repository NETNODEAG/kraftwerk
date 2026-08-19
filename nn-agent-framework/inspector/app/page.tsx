"use client";

import type { RunListItem } from "@/lib/runs";
import { usePoll, fmtDuration, fmtCost, fmtWhen, Lamp, StatusWord, Elapsed } from "./shared";

export default function RunIndex() {
  const data = usePoll<{ outputDir: string; runs: RunListItem[] }>("/api/runs", true);
  const runs = data?.runs ?? [];
  const live = runs.filter((r) => r.status === "running").length;

  return (
    <>
      <div className="page-head">
        <h1>Runs</h1>
        <span className="count num">
          {runs.length} total{live > 0 ? ` · ${live} live` : ""}
        </span>
      </div>

      {data && runs.length === 0 && (
        <div className="empty">
          No runs found in <code>{data.outputDir}</code>. Start one with{" "}
          <code>kraftwerk run &lt;workflow&gt; &lt;request&gt;</code>.
        </div>
      )}

      <div className="run-list">
        {runs.map((r) => (
          <a key={r.id} href={`/runs/${r.id}`} className={`run-card is-${r.status}`}>
            <Lamp status={r.status} />
            <div>
              <div className="wf">{r.workflow ?? "unknown workflow"}</div>
              <div className="rid">{r.id.replace(/^run-/, "")}</div>
            </div>
            <div>
              <div className="req" title={r.request}>{r.request ?? ""}</div>
              <div className="microlabel" style={{ marginTop: 3 }}>
                {r.status === "running" && r.currentPhase ? (
                  <>phase · {r.currentPhase}</>
                ) : (
                  <StatusWord status={r.status} />
                )}
              </div>
            </div>
            <div className="meta num">
              {r.phasesTotal != null && (
                <span className="progress-track" title={`${r.phasesDone}/${r.phasesTotal} phases`}>
                  <i style={{ width: `${Math.round((r.phasesDone / Math.max(1, r.phasesTotal)) * 100)}%` }} />
                </span>
              )}
              <span>
                {r.status === "running" ? <Elapsed since={r.startedAt} /> : fmtDuration(r.durationMs)}
              </span>
              <span>{fmtCost(r.costUsd)}</span>
              <span>{fmtWhen(r.startedAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
