import { useState } from "react";
import type { WorkflowDetail, AgentInfo, StepInfo, RunListItem } from "./types";
import { Link, navigate, usePoll, fmtDuration, fmtCost, fmtWhen, Elapsed } from "./shared";
import { RunForm } from "./run-launcher";
import { WorkflowBoard, StepIndex, agentColour } from "./workflow-board";
import { DecisionTag, RunStatus, Stat, STATS, TIMELINE_ROW, runTone } from "./runs";
import { Button, cn, Dot, EmptyState, Hint, Notice, Panel, Tabs, Tag, Title } from "./ui";

export type WorkflowTab = "overview" | "details" | "runs";

/** Fired with the slug when a workflow is deleted, so the list drops it at once. */
export const WORKFLOW_DELETED_EVENT = "kw-workflow-deleted";

/**
 * One workflow, three tabs on their own routes: overview (trigger + board —
 * what to act on), details (agents, pipeline, folder — how it is built),
 * runs (every run of this workflow, newest first). Details ends with the
 * delete (into the trash), as does a broken workflow's page.
 */
export function WorkflowView({ slug, tab }: { slug: string; tab: WorkflowTab }) {
  const wf = usePoll<WorkflowDetail>(`/api/workflows/${encodeURIComponent(slug)}`, false);
  // A launch from this page stays here; the poll tightens until the new
  // run is on the board (and stays tight while any run of this workflow is live).
  const [launchedAt, setLaunchedAt] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const runsData = usePoll<{ runs: RunListItem[] }>("/api/runs", liveCount > 0 || Date.now() - launchedAt < 20_000);

  if (!wf) return <EmptyState>loading…</EmptyState>;
  if (wf.error) {
    return (
      <EmptyState>
        <Tag tone="bad">broken workflow</Tag>
        <pre className="mt-3 text-left">{wf.error}</pre>
        <div className="mt-4 flex justify-center">
          <DeleteWorkflow slug={wf.slug} />
        </div>
      </EmptyState>
    );
  }

  const agentIdx = new Map(wf.agents.map((a, i) => [a.id, i % 4]));
  const runs = (runsData?.runs ?? []).filter((r) => r.workflow === wf.name || r.workflow === wf.slug);
  const base = `/workflows/${encodeURIComponent(wf.slug)}`;
  const live = runs.filter((r) => r.status === "running").length;
  if (live !== liveCount) setLiveCount(live);

  return (
    <>
      <header className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 in-[.ctx-embed]:mb-3 in-[.ctx-embed]:gap-y-2">
        <Title size="lg" className="in-[.ctx-embed]:text-xl">{wf.name ?? wf.slug}</Title>
        <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-fg-2 in-[.ctx-embed]:hidden">{wf.dir}</span>
        <span className="flex-1" />
        <Tabs
          bare
          label="workflow sections"
          value={tab}
          items={[
            { id: "overview", href: base, label: "overview" },
            { id: "details", href: `${base}/details`, label: "details" },
            { id: "runs", href: `${base}/runs`, label: <>runs <span className="tabular-nums">({runs.length})</span></> },
          ]}
        />
      </header>
      {wf.description && <p className="mb-5 max-w-[90ch] text-base text-fg-2">{wf.description}</p>}

      {tab === "overview" && (
        <>
          <Panel className="run-panel mb-[18px]">
            <RunForm
              slug={wf.slug}
              usesRequest={wf.usesRequest}
              initialRequest={runs[0]?.request}
              onLaunched={() => setLaunchedAt(Date.now())}
            />
          </Panel>

          <Panel
            title={
              <>
                board{" "}
                <span className="tabular-nums">
                  ({runs.length} runs{live > 0 ? `, ${live} live` : ""})
                </span>
              </>
            }
            actions={
              runs[0] && (
                <Button size="sm" variant="quiet" href={`${base}/runs`} className="in-[.ctx-embed]:hidden">
                  all runs ↗
                </Button>
              )
            }
          >
            <WorkflowBoard wf={wf} runs={runs} agentIdx={agentIdx} runsHref={`${base}/runs`} />
          </Panel>
        </>
      )}

      {tab === "details" && <Details wf={wf} agentIdx={agentIdx} />}

      {tab === "runs" && <RunList runs={runs} />}
    </>
  );
}

function Details({ wf, agentIdx }: { wf: WorkflowDetail; agentIdx: Map<string, number> }) {
  return (
    <>
      <div className={STATS}>
        <Stat label="agents">{wf.agents.length}</Stat>
        <Stat label="steps">
          {wf.steps.length}{" "}
          <span className="font-normal text-fg-2">
            ({wf.steps.filter((s) => s.kind === "agent").length} agent · {wf.steps.filter((s) => s.kind === "script").length} script)
          </span>
        </Stat>
        {wf.workspace && (
          <Stat label="workspace" className="max-w-[420px]">
            <span className="text-[11.5px] font-normal whitespace-pre-wrap text-fg-2">{wf.workspace}</span>
          </Stat>
        )}
      </div>

      <Panel title="agents" className="mb-[18px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
          {wf.agents.map((a) => (
            <AgentCard key={a.id} a={a} idx={agentIdx.get(a.id) ?? 0} />
          ))}
          {wf.agents.length === 0 && <Hint className="px-[18px] py-3">no agents — script-only workflow</Hint>}
        </div>
      </Panel>

      <div className="grid items-start gap-[18px] grid-cols-[minmax(430px,5fr)_minmax(360px,4fr)] max-[1100px]:grid-cols-1 in-[.ctx-embed]:grid-cols-1">
        <Panel title="pipeline">
          <div className="pipeline py-2">
            {wf.steps.map((s, i) => (
              <StepNode key={s.name} s={s} i={i} idx={s.agent ? agentIdx.get(s.agent) ?? 0 : null} />
            ))}
          </div>
        </Panel>

        <Panel
          title={
            <>
              folder <span className="tabular-nums">({wf.files.length} files)</span>
            </>
          }
        >
          <div className="max-h-[300px] overflow-auto">
            {wf.files.map((f) => (
              <div key={f} className="truncate border-b border-line/55 px-[18px] py-2 font-mono text-[12.5px] text-fg-2 last:border-b-0">
                {f}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-[18px] in-[.ctx-embed]:hidden">
        <DeleteWorkflow slug={wf.slug} />
      </div>
    </>
  );
}

/** Delete, confirmed in place: the workflow goes to the trash (#/trash puts it back). */
function DeleteWorkflow({ slug }: { slug: string }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/workflows/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      window.dispatchEvent(new CustomEvent(WORKFLOW_DELETED_EVENT, { detail: slug }));
      navigate("/workflows", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!confirm ? (
          <Button variant="danger" icon="delete" onClick={() => setConfirm(true)} title="Move the workflow's folder to the trash">
            delete workflow
          </Button>
        ) : (
          <>
            <Button variant="danger" icon="delete" busy={busy} onClick={() => void remove()}>
              confirm delete
            </Button>
            <Button variant="quiet" onClick={() => setConfirm(false)}>cancel</Button>
            <Hint>its runs stay; the trash can put it back</Hint>
          </>
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

/** Every run of the workflow, newest first — the board's cards as a flat list. */
function RunList({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) return <EmptyState>no runs of this workflow yet</EmptyState>;
  return (
    <div className="flex flex-col gap-2">
      {runs.map((r) => {
        const total = r.phasesTotal ?? 0;
        const pct = total > 0 ? Math.round((r.phasesDone / total) * 100) : r.status === "ok" ? 100 : 0;
        return (
          <Link
            key={r.id}
            href={`/runs/${r.id}`}
            className="run-card grid grid-cols-[12px_200px_1fr_auto] items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-5 py-3.5 text-inherit no-underline transition-colors hover:bg-surface-2 max-[900px]:grid-cols-[12px_1fr]"
          >
            <Dot tone={runTone(r.status)} title={r.status} />
            <span className="font-mono text-[12.5px] text-fg-2">{r.id.replace(/^run-/, "")}</span>
            <span className="min-w-0 truncate text-fg" title={r.request}>
              {r.status === "running" && r.currentPhase ? r.currentPhase : (r.request ?? "")}
            </span>
            <span className="flex items-center gap-3.5 font-mono text-xs tabular-nums text-fg-2 max-[900px]:col-span-2">
              {r.awaitingDecision && <DecisionTag />}
              <RunStatus status={r.status} />
              <span className="h-1 w-[90px] overflow-hidden rounded-full bg-surface-2" title={`${r.phasesDone}${total ? ` / ${total}` : ""} steps`}>
                <i className={cn("block h-full rounded-full", r.status === "ok" ? "bg-ok" : r.status === "failed" ? "bg-bad" : "bg-accent")} style={{ width: `${pct}%` }} />
              </span>
              <span>{r.status === "running" ? <Elapsed since={r.startedAt} /> : fmtDuration(r.durationMs)}</span>
              <span>{fmtCost(r.costUsd)}</span>
              <span>{fmtWhen(r.startedAt)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

const ROW_LINE = "border-line/55";

function AgentCard({ a, idx }: { a: AgentInfo; idx: number }) {
  return (
    <div className={cn("agent-card border-r border-b px-[18px] py-3.5", ROW_LINE)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: agentColour(idx) }} />
        <b className="text-base font-medium text-fg">{a.name ?? a.id}</b>
        <code className="text-2xs text-fg-2">[{a.id}]</code>
        <span className="flex-1" />
        <Tag>
          {a.model ?? "default"}
          {a.effort ? ` · ${a.effort}` : ""}
          {a.protocol === "acp" ? " · acp" : ""}
        </Tag>
      </div>
      {a.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-[5px]">
          {a.tools.map((t) => (
            <span key={t} className="rounded-md bg-surface-2 px-2 py-px font-mono text-2xs text-fg-2">
              {t}
            </span>
          ))}
        </div>
      )}
      {a.persona && <p className="mt-2 mb-0 text-xs leading-[1.55] whitespace-pre-wrap text-fg-2">{a.persona}</p>}
    </div>
  );
}

function StepNode({ s, i, idx }: { s: StepInfo; i: number; idx: number | null }) {
  const body = s.kind === "script" ? s.script : s.prompt;
  return (
    <div className={cn("step-node flex gap-3.5 px-[18px] py-3 first:before:top-[18px] last:before:h-[18px] before:left-[31px]", TIMELINE_ROW)}>
      <StepIndex colour={agentColour(idx)}>{i + 1}</StepIndex>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-base font-medium text-fg">{s.name}</span>
          {s.kind === "agent" ? (
            <span
              className="inline-flex h-5 items-center rounded-full border px-2 text-2xs font-semibold"
              style={{ color: agentColour(idx ?? 0), borderColor: `color-mix(in srgb, ${agentColour(idx ?? 0)} 50%, var(--line))` }}
            >
              agent · {s.agent}
            </span>
          ) : (
            <Tag>script{s.sourceRef ? ` · ${s.sourceRef}` : ""}</Tag>
          )}
        </div>
        {body && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-medium text-fg-2 select-none hover:text-accent">{s.kind === "agent" ? "prompt" : "script"}</summary>
            <pre className="mt-1.5 max-h-[360px] overflow-auto rounded-xl bg-surface-2 px-3 py-2.5 text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-fg-2">{body}</pre>
          </details>
        )}
        {s.gates.length > 0 && (
          <div className="mt-[5px] flex flex-wrap gap-1.5">
            {s.gates.map((g) => (
              <span key={g} className="inline-flex items-center gap-[5px] rounded-lg bg-surface-2 px-2.5 py-0.5 font-mono text-2xs text-fg-2">
                ⛨ {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
