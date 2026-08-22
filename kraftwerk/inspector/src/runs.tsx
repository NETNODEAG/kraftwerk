import { useEffect, useState } from "react";
import type { RunDetail, RunListItem, PhaseView, FileView } from "./types";
import { createChatAndOpen } from "./chat";
import {
  Link,
  usePoll,
  fmtDuration,
  fmtCost,
  fmtTokens,
  fmtSize,
  fmtWhen,
  Lamp,
  StatusWord,
  Elapsed,
} from "./shared";

/**
 * Full-width runs screen: a sidebar with every run (latest on top) for
 * quick switching, and a main area with two tabs — "run" (phase timeline)
 * and "artifacts" (file browser with a large viewer). Finished runs open
 * on artifacts, running ones on the timeline.
 */
export function RunsScreen({ id }: { id: string }) {
  const data = usePoll<{ runs: RunListItem[] }>("/api/runs", true);
  const runs = data?.runs ?? [];

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">runs</span>
          <span className="spacer" />
          <span className="microlabel num">{runs.length}</span>
        </div>
        <div className="side-list">
          {runs.map((r) => (
            <SideRow key={r.id} r={r} active={r.id === id} />
          ))}
          {data && runs.length === 0 && <div className="viewer-note">no runs yet</div>}
        </div>
      </aside>
      <div className="runs-main">
        <RunDetailView key={id} id={id} />
      </div>
    </div>
  );
}

function SideRow({ r, active }: { r: RunListItem; active: boolean }) {
  return (
    <Link href={`/runs/${r.id}`} className={`side-row ${active ? "active" : ""}`}>
      <Lamp status={r.status} />
      <div className="side-row-body">
        <div className="side-row-top">
          <span className="side-wf">{r.workflow ?? "unknown"}</span>
          <span className="side-when num">{fmtWhen(r.startedAt)}</span>
        </div>
        <div className="side-row-sub">
          <span className="side-req" title={r.request}>
            {r.status === "running" && r.currentPhase ? `▸ ${r.currentPhase}` : (r.request ?? "")}
          </span>
          <span className="side-meta num">
            {r.status === "running" ? <Elapsed since={r.startedAt} /> : fmtDuration(r.durationMs)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ---------- detail ---------- */

function RunDetailView({ id }: { id: string }) {
  const run = usePoll<RunDetail>(`/api/runs/${id}`, true);
  const live = run?.status === "running";
  const [tab, setTab] = useState<"run" | "artifacts" | null>(null);
  const [stopping, setStopping] = useState(false);

  if (!run) return <div className="empty">loading…</div>;
  const sandboxed = run.files.some((f) => f.name === "runner.json");
  const active = tab ?? (live ? "run" : "artifacts");

  async function stop() {
    setStopping(true);
    await fetch(`/api/runs/${id}/stop`, { method: "POST" }).catch(() => {});
  }

  return (
    <>
      <div className="detail-head">
        <Lamp status={run.status} />
        <h1>
          {run.workflow ? (
            <Link href={`/workflows/${encodeURIComponent(run.workflow)}`} title="open workflow">
              {run.workflow}
            </Link>
          ) : (
            "unknown workflow"
          )}
        </h1>
        <StatusWord status={run.status} />
        {sandboxed && <span className="chip sandbox-chip">⬒ sandbox</span>}
        <span className="rid">{id.replace(/^run-/, "")}</span>
        {live && sandboxed && (
          <button className="stop-btn" onClick={stop} disabled={stopping}>
            {stopping ? "stopping…" : "■ stop"}
          </button>
        )}
        <span className="spacer" />
        <button
          className="open-raw"
          title="chat with an agent about this run"
          onClick={() => void createChatAndOpen("claude", { kind: "run", runId: id })}
        >
          ⌬ discuss
        </button>
        <nav className="tabs">
          <button className={active === "run" ? "active" : ""} onClick={() => setTab("run")}>
            run
          </button>
          <button
            className={active === "artifacts" ? "active" : ""}
            onClick={() => setTab("artifacts")}
          >
            artifacts <span className="num">({run.files.length})</span>
          </button>
        </nav>
      </div>
      {run.request && <p className="detail-req">{run.request}</p>}

      {active === "run" ? (
        <RunTab run={run} live={live} />
      ) : (
        <ArtifactsTab id={id} files={run.files} live={live} />
      )}
    </>
  );
}

function RunTab({ run, live }: { run: RunDetail; live: boolean }) {
  return (
    <div className="run-tab">
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
    </div>
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

/* ---------- artifacts ---------- */

const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function ArtifactsTab({ id, files, live }: { id: string; files: FileView[]; live: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Default selection: the most interesting artifact.
  useEffect(() => {
    if (selected || files.length === 0) return;
    const prefer = ["report.html", "recommendation.md", "trace.jsonl"];
    setSelected(prefer.find((n) => files.some((f) => f.name === n)) ?? files[0].name);
  }, [files, selected]);

  return (
    <div className="art-layout">
      <section className="panel art-files">
        <div className="panel-head">
          <span className="microlabel">
            files <span className="num">({files.length})</span>
          </span>
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
      </section>

      <section className="panel art-viewer">
        <div className="panel-head">
          <span className="microlabel">{selected ?? "viewer"}</span>
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
        {selected ? (
          <Viewer id={id} name={selected} live={live} />
        ) : (
          <div className="empty">select a file</div>
        )}
      </section>
    </div>
  );
}

function Viewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const rawUrl = `/api/runs/${id}/file?name=${encodeURIComponent(name)}&raw=1`;

  if (ext === "html") {
    return (
      <div className="viewer">
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
