"use client";

import { useEffect, useState } from "react";
import type { RunDetail, PhaseView, FileView } from "@/lib/runs";
import {
  usePoll,
  fmtDuration,
  fmtCost,
  fmtTokens,
  fmtSize,
  fmtWhen,
  Lamp,
  StatusWord,
  Elapsed,
} from "../../shared";

export function RunDetailView({ id }: { id: string }) {
  const run = usePoll<RunDetail>(`/api/runs/${id}`, true);
  const live = run?.status === "running";

  if (!run) return <div className="empty">loading…</div>;

  return (
    <>
      <nav className="crumbs">
        <a href="/">runs</a>
        <span className="sep">/</span>
        <span className="mono">{id}</span>
      </nav>

      <div className="detail-head">
        <Lamp status={run.status} />
        <h1>
          {run.workflow ? (
            <a href={`/workflows/${encodeURIComponent(run.workflow)}`} title="open workflow">
              {run.workflow}
            </a>
          ) : (
            "unknown workflow"
          )}
        </h1>
        <StatusWord status={run.status} />
        <span className="rid">{fmtWhen(run.startedAt)}</span>
      </div>
      {run.request && <p className="detail-req">{run.request}</p>}

      <div className="statgrid">
        <div className="stat">
          <div className="microlabel">phases</div>
          <div className="v num">
            {run.phasesDone}
            {run.phasesTotal != null ? ` / ${run.phasesTotal}` : ""}
          </div>
        </div>
        <div className="stat">
          <div className="microlabel">duration</div>
          <div className="v num">
            {live ? <Elapsed since={run.startedAt} /> : fmtDuration(run.durationMs)}
          </div>
        </div>
        <div className="stat">
          <div className="microlabel">cost</div>
          <div className="v num">{fmtCost(run.costUsd ?? sumCost(run.phases))}</div>
        </div>
        <div className="stat">
          <div className="microlabel">tokens in / out</div>
          <div className="v num">
            {fmtTokens(sum(run.phases, "tokensIn"))} / {fmtTokens(sum(run.phases, "tokensOut"))}
          </div>
        </div>
      </div>

      <div className="columns">
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">phase timeline</span>
            <span className="spacer" />
            {live && (
              <span className="live-note">
                <span className="lamp running" /> live · polling
              </span>
            )}
          </div>
          <div className="phases">
            {run.phases.map((p) => (
              <PhaseRow key={p.phase} p={p} />
            ))}
          </div>
        </section>

        <FilesPanel id={id} files={run.files} live={live} />
      </div>
    </>
  );
}

function sum(phases: PhaseView[], k: "tokensIn" | "tokensOut"): number {
  return phases.reduce((a, p) => a + (p[k] ?? 0), 0);
}
function sumCost(phases: PhaseView[]): number {
  return phases.reduce((a, p) => a + (p.costUsd ?? 0), 0);
}

function PhaseRow({ p }: { p: PhaseView }) {
  const failedGates = p.gates.filter((g) => !g.passed);
  return (
    <div className="phase-row">
      <Lamp status={p.status} />
      <div className="phase-top">
        <span className="phase-name">{p.phase}</span>
        {p.kind === "agent" ? (
          <span className="chip agent">
            {p.agent}
            {p.model ? ` · ${p.model}` : ""}
          </span>
        ) : (
          <span className="chip">script</span>
        )}
        <span className="right num">
          {p.attempts > 1 && <span>att {p.attempts}</span>}
          {p.status === "running" ? (
            <Elapsed since={p.startedAt} />
          ) : (
            p.durationMs != null && <span>{fmtDuration(p.durationMs)}</span>
          )}
          {p.kind === "agent" && p.tokensIn != null && (
            <span>
              {fmtTokens(p.tokensIn)} / {fmtTokens(p.tokensOut)}
            </span>
          )}
          {p.costUsd != null && p.costUsd > 0 && <span>{fmtCost(p.costUsd)}</span>}
        </span>
      </div>
      {p.status === "running" && p.lastActivity && (
        <div className="phase-activity">{p.lastActivity}</div>
      )}
      {p.summary && p.status !== "running" && <div className="phase-sub">{p.summary}</div>}
      {p.gates.length > 0 && (
        <div className="gate-line">
          {p.gates.map((g) => (
            <span key={g.gate} className={`gate ${g.passed ? "" : "failed"}`} title={g.failure ?? ""}>
              {g.passed ? "✓" : "✕"} {g.gate}
            </span>
          ))}
        </div>
      )}
      {failedGates.map((g) => (
        <div key={g.gate} className="gate-fail-msg">
          {g.failure}
        </div>
      ))}
    </div>
  );
}

/* ---------- files ---------- */

const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function FilesPanel({ id, files, live }: { id: string; files: FileView[]; live: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Default selection: the most interesting artifact.
  useEffect(() => {
    if (selected || files.length === 0) return;
    const prefer = ["report.html", "recommendation.md", "trace.jsonl"];
    setSelected(prefer.find((n) => files.some((f) => f.name === n)) ?? files[0].name);
  }, [files, selected]);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">
          files <span className="num">({files.length})</span>
        </span>
        <span className="spacer" />
        {selected && (
          <a
            className="open-raw"
            href={`/api/runs/${id}/file?name=${encodeURIComponent(selected)}&raw=1`}
            target="_blank"
          >
            open raw ↗
          </a>
        )}
      </div>
      <div className="file-list">
        {files.map((f) => (
          <button
            key={f.name}
            className={`file-row ${selected === f.name ? "active" : ""}`}
            onClick={() => setSelected(f.name)}
          >
            <span className="fname">{f.name}</span>
            <span className="fsize num">{fmtSize(f.size)}</span>
          </button>
        ))}
        {files.length === 0 && <div className="viewer-note">no files yet</div>}
      </div>
      {selected && <Viewer id={id} name={selected} live={live} />}
    </section>
  );
}

function Viewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const rawUrl = `/api/runs/${id}/file?name=${encodeURIComponent(name)}&raw=1`;

  if (ext === "html") {
    return (
      <div className="viewer">
        <div className="viewer-note">rendered preview — {name}</div>
        <div className="viewer-body">
          <iframe src={rawUrl} sandbox="allow-scripts" allow="clipboard-write" title={name} />
        </div>
      </div>
    );
  }
  if (IMG.has(ext)) {
    return (
      <div className="viewer">
        <div className="viewer-body">
          <img src={rawUrl} alt={name} />
        </div>
      </div>
    );
  }
  return <TextViewer id={id} name={name} live={live} />;
}

function TextViewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const data = usePoll<{ content: string; truncated: boolean; size: number }>(
    `/api/runs/${id}/file?name=${encodeURIComponent(name)}`,
    live
  );
  return (
    <div className="viewer">
      {data?.truncated && (
        <div className="viewer-note">large file — showing the last {fmtSize(400_000)}</div>
      )}
      <div className="viewer-body">
        <pre>{data ? data.content || "(empty)" : "loading…"}</pre>
      </div>
    </div>
  );
}
