import { DecisionPanel } from "./decision";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { RunDetail, RunListItem, PhaseView, FileView } from "./types";
import { createChatAndOpen } from "./chat";
import { api, useApi } from "./api";
import {
  Link,
  navigate,
  fmtDuration,
  fmtCost,
  fmtTokens,
  fmtSize,
  fmtWhen,
  Elapsed,
  useExpertMode,
  Icon,
} from "./shared";
import { Button, cn, Dot, EmptyState, Eyebrow, Hint, ListRow, Panel, SideHead, SideList, SideNote, SideSearch, Tabs, Tag, Title, type DotTone } from "./ui";

/* ---------- run states, shared by the workflows screens ---------- */

/** A run or phase status as a dot: running pulses, failed is red, the rest are hollow. */
export function runTone(status?: string): DotTone {
  if (status === "ok") return "ok";
  if (status === "running") return "working";
  if (status === "failed" || status === "blocked") return "bad";
  return "idle";
}

/** A run status as a word in a tag; `data-ui="status"` is the hook tests read. */
export function RunStatus({ status }: { status: string }) {
  const tone = status === "ok" ? "ok" : status === "failed" || status === "blocked" ? "bad" : status === "running" ? "accent" : "neutral";
  return (
    <span data-ui="status" data-status={status} className="inline-flex">
      <Tag tone={tone}>{status}</Tag>
    </span>
  );
}

/** "decision needed" on a run that waits for a human. */
export function DecisionTag() {
  return (
    <span data-ui="decision" className="inline-flex">
      <Tag tone="accent">decision needed</Tag>
    </span>
  );
}

/** A labelled number in a row of them (phases, duration, cost). */
export function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Eyebrow className="mb-px block">{label}</Eyebrow>
      <div className="font-mono text-md font-medium tabular-nums text-fg">{children}</div>
    </div>
  );
}
export const STATS = "mb-[22px] flex flex-wrap gap-[26px]";

/**
 * Full-width runs screen: a sidebar with every run (latest on top) for
 * quick switching, and a main area with two tabs — "run" (phase timeline)
 * and "artifacts" (file browser with a large viewer). Finished runs open
 * on artifacts, running ones on the timeline.
 */
export function RunsScreen({ id, workflow }: { id: string; workflow?: string }) {
  const data = useApi("runs.list", {}, { fast: true });
  const runs = data?.runs ?? [];
  // The workflows list links here with ?workflow=<name>; the box is free text after that.
  const [filter, setFilter] = useState(workflow ?? "");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter((r) =>
      [r.workflow, r.request, r.id].some((s) => s?.toLowerCase().includes(needle))
    );
  }, [runs, filter]);

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead title="runs" back={{ href: "/workflows", label: "back to workflows" }} count={filter ? `${shown.length} / ${runs.length}` : runs.length} />
        <SideSearch icon="filter_list" value={filter} placeholder="filter by workflow or request" aria-label="filter runs" onChange={(e) => setFilter(e.target.value)} />
        <SideList label="runs list">
          {shown.map((r) => (
            <SideRow key={r.id} r={r} active={r.id === id} />
          ))}
          {data && runs.length === 0 && <SideNote>no runs yet</SideNote>}
          {runs.length > 0 && shown.length === 0 && <SideNote>no run matches “{filter}”</SideNote>}
        </SideList>
      </aside>
      <div className="runs-main">
        <RunDetailView key={id} id={id} />
      </div>
    </div>
  );
}

function SideRow({ r, active }: { r: RunListItem; active: boolean }) {
  return (
    <ListRow
      href={`/runs/${r.id}`}
      active={active}
      size="sm"
      leading={<Dot tone={runTone(r.status)} title={r.status} />}
      title={r.workflow ?? "unknown"}
      meta={fmtWhen(r.startedAt)}
      sub={
        <span className="flex gap-2">
          <span className="min-w-0 flex-1 truncate" title={r.request}>
            {r.status === "running" && r.currentPhase ? `${r.currentPhase}` : (r.request ?? "")}
          </span>
          <span className="shrink-0 tabular-nums">{r.status === "running" ? <Elapsed since={r.startedAt} /> : fmtDuration(r.durationMs)}</span>
        </span>
      }
    />
  );
}

/* ---------- detail ---------- */

function RunDetailView({ id }: { id: string }) {
  const run = useApi("runs.get", { id }, { fast: true });
  const live = run?.status === "running";
  const [tab, setTab] = useState<"run" | "artifacts" | null>(null);
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const expert = useExpertMode();

  if (!run) return <EmptyState>loading…</EmptyState>;
  const sandboxed = run.files.some((f) => f.name === "runner.json");
  const active = tab ?? (live ? "run" : "artifacts");
  const fileCount = expert ? run.files.length : run.files.filter((f) => !isMachineFile(f.name)).length;

  async function stop() {
    setStopping(true);
    setBusy(null);
    const r = await api.request("runs.stop", { id }).catch(() => null);
    if (!r?.ok) {
      setStopping(false);
      setBusy((r?.data as { error?: string } | undefined)?.error ?? "stop failed");
    }
  }

  async function remove() {
    if (!window.confirm(`Move run ${id} to the trash?`)) return;
    setBusy(null);
    const r = await api.request("runs.delete", { id }).catch(() => null);
    if (r?.ok) {
      navigate(run?.workflow ? `/workflows/${encodeURIComponent(run.workflow)}` : "/workflows");
      return;
    }
    setBusy((r?.data as { error?: string } | undefined)?.error ?? "remove failed");
  }

  return (
    <>
      <header className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Dot tone={runTone(run.status)} title={run.status} />
        <Title size="lg">
          {run.workflow ? (
            <Link href={`/workflows/${encodeURIComponent(run.workflow)}`} title="open workflow" className="text-inherit no-underline hover:text-accent">
              {run.workflow}
            </Link>
          ) : (
            "unknown workflow"
          )}
        </Title>
        <RunStatus status={run.status} />
        {sandboxed && (
          <Tag>
            <Icon name="science" className="ms-sm mr-1" /> sandbox
          </Tag>
        )}
        <span className="font-mono text-xs text-fg-2">{id.replace(/^run-/, "")}</span>
        {live ? (
          <Button size="sm" variant="danger" icon="stop" busy={stopping} onClick={stop}>
            {stopping ? "stopping…" : "stop"}
          </Button>
        ) : (
          <Button size="sm" variant="danger" icon="delete" onClick={remove} title="delete this run's folder">
            remove
          </Button>
        )}
        {busy && <span className="text-xs text-bad">{busy}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="quiet" title="chat with an agent about this run" onClick={() => void createChatAndOpen("claude", { kind: "run", runId: id })}>
          ⌬ discuss
        </Button>
        <Tabs
          className="border-b-0 px-0"
          label="run sections"
          value={active}
          onChange={setTab}
          items={[
            { id: "run", label: "run" },
            { id: "artifacts", label: "artifacts", count: fileCount },
          ]}
        />
      </header>
      {run.request && <p className="mb-5 max-w-[90ch] text-base text-fg-2">{run.request}</p>}

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
    <div className="max-w-[1080px]">
      {run.decision && <DecisionPanel runId={run.id} decision={run.decision} />}
      <div className={STATS}>
        <Stat label="phases">
          {run.phasesDone}
          {run.phasesTotal != null ? ` / ${run.phasesTotal}` : ""}
        </Stat>
        <Stat label="duration">{live ? <Elapsed since={run.startedAt} /> : fmtDuration(run.durationMs)}</Stat>
        <Stat label="cost">{fmtCost(run.costUsd ?? sumCost(run.phases))}</Stat>
        <Stat label="tokens in / out">
          {fmtTokens(sum(run.phases, "tokensIn"))} / {fmtTokens(sum(run.phases, "tokensOut"))}
        </Stat>
      </div>

      <Panel
        title="phase timeline"
        actions={
          live && (
            <span className="inline-flex items-center gap-[7px] text-2xs text-fg-2">
              <Dot tone="working" /> live · polling
            </span>
          )
        }
      >
        <div className="py-1.5">
          {run.phases.map((p) => (
            <PhaseRow key={p.phase} p={p} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function sum(phases: PhaseView[], k: "tokensIn" | "tokensOut"): number {
  return phases.reduce((a, p) => a + (p[k] ?? 0), 0);
}
function sumCost(phases: PhaseView[]): number {
  return phases.reduce((a, p) => a + (p.costUsd ?? 0), 0);
}

/** A step or phase: a node on a vertical line, the line running through the whole list. */
export const TIMELINE_ROW =
  "relative border-line/55 [&+&]:border-t before:absolute before:top-0 before:bottom-0 before:w-px before:bg-line last:before:bottom-auto";

function PhaseRow({ p }: { p: PhaseView }) {
  const failedGates = p.gates.filter((g) => !g.passed);
  return (
    <div className={cn(TIMELINE_ROW, "py-2.5 pr-[18px] pl-[42px] before:left-[23px] first:before:top-4 last:before:h-4")}>
      <span className="absolute top-4 left-[19px] z-1 grid">
        <Dot tone={runTone(p.status)} title={p.status} />
      </span>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-base font-medium text-fg">{p.phase}</span>
        {p.kind === "agent" ? (
          <Tag tone="accent">
            {p.agent}
            {p.model ? ` · ${p.model}` : ""}
            {p.protocol ? ` · ${p.protocol}` : ""}
          </Tag>
        ) : (
          <Tag>script</Tag>
        )}
        {p.status === "skipped" && <RunStatus status="skipped" />}
        <span className="ml-auto flex gap-3.5 font-mono text-[11.5px] tabular-nums text-fg-2">
          {p.attempts > 1 && <span>att {p.attempts}</span>}
          {p.status === "running" ? <Elapsed since={p.startedAt} /> : p.durationMs != null && <span>{fmtDuration(p.durationMs)}</span>}
          {p.kind === "agent" && p.tokensIn != null && (
            <span>
              {fmtTokens(p.tokensIn)} / {fmtTokens(p.tokensOut)}
            </span>
          )}
          {p.costUsd != null && p.costUsd > 0 && <span>{fmtCost(p.costUsd)}</span>}
        </span>
      </div>
      {p.status === "running" && p.lastActivity && <div className="mt-[3px] font-mono text-[11.5px] text-accent">▸ {p.lastActivity}</div>}
      {p.summary && p.status !== "running" && <div className="mt-[3px] max-w-[72ch] text-[12.5px] text-fg-2">{p.summary}</div>}
      {p.gates.length > 0 && (
        <div className="mt-[5px] flex flex-wrap gap-1.5">
          {p.gates.map((g) => (
            <span
              key={g.gate}
              className={cn("inline-flex items-center gap-[5px] rounded-lg px-2.5 py-0.5 font-mono text-2xs", g.passed ? "bg-ok-soft text-ok" : "bg-bad-soft text-on-bad-soft")}
              title={g.failure ?? ""}
            >
              <Icon name={g.passed ? "check" : "close"} className="ms-sm" /> {g.gate}
            </span>
          ))}
        </div>
      )}
      {failedGates.map((g) => (
        <div key={g.gate} className="mt-1 text-xs text-bad">
          {g.failure}
        </div>
      ))}
    </div>
  );
}

/* ---------- artifacts ---------- */

const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/** Files the machinery writes for itself — noise outside expert mode. */
export function isMachineFile(name: string): boolean {
  return name === "runner.json" || name.endsWith(".jsonl") || name.endsWith(".log");
}

/** Result-first default: named reports, then anything renderable, machine files last. */
function defaultArtifact(files: FileView[]): string | null {
  const named = ["report.html", "recommendation.md"];
  const hit = named.find((n) => files.some((f) => f.name === n));
  if (hit) return hit;
  const rank = (n: string) => {
    const ext = n.split(".").pop()?.toLowerCase() ?? "";
    if (["html", "md", "markdown", "pdf"].includes(ext) || IMG.has(ext)) return 0;
    return isMachineFile(n) ? 2 : 1;
  };
  let best: FileView | null = null;
  for (const f of files) if (!best || rank(f.name) < rank(best.name)) best = f;
  return best?.name ?? null;
}

function ArtifactsTab({ id, files, live }: { id: string; files: FileView[]; live: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const expert = useExpertMode();
  const visible = useMemo(
    () => (expert ? files : files.filter((f) => !isMachineFile(f.name))),
    [files, expert]
  );

  // Turning expert off while a machine file is open: fall back to a result.
  useEffect(() => {
    if (!expert && selected && isMachineFile(selected)) setSelected(null);
  }, [expert, selected]);

  // Default selection: the run's result, never the trace.
  useEffect(() => {
    if (selected || visible.length === 0) return;
    setSelected(defaultArtifact(visible));
  }, [visible, selected]);

  return (
    <div className="grid h-[calc(100vh-172px)] min-h-[420px] grid-cols-[280px_minmax(0,1fr)] gap-3.5 max-[940px]:h-auto max-[940px]:grid-cols-1">
      <Panel title={<>files <span className="tabular-nums">({visible.length})</span></>} className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto max-[940px]:max-h-60">
          {visible.map((f) => (
            <button
              key={f.name}
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 border-0 border-b border-line/55 px-[18px] py-2 text-left font-mono text-[12.5px] transition-colors last:border-b-0",
                selected === f.name ? "bg-accent-soft text-on-accent-soft" : "bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg"
              )}
              onClick={() => setSelected(f.name)}
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-2xs tabular-nums text-fg-2">{fmtSize(f.size)}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <Hint className="px-[18px] py-3">{files.length > 0 ? "no result files — raw run files live in expert mode" : "no files yet"}</Hint>
          )}
        </div>
      </Panel>

      <Panel
        title={selected ?? "viewer"}
        className="flex min-h-0 flex-col"
        actions={
          selected && (
            <a className={buttonLink} href={api.url("runs.file", { id, query: { name: selected, raw: true } })} target="_blank">
              open raw ↗
            </a>
          )
        }
      >
        {selected ? <Viewer id={id} name={selected} live={live} /> : <EmptyState className="flex-1 justify-center">select a file</EmptyState>}
      </Panel>
    </div>
  );
}

/** A plain anchor that looks like a quiet small Button (Button only makes hash links). */
const buttonLink =
  "inline-flex h-7 items-center rounded-control px-2.5 text-sm font-medium text-fg-2 no-underline transition-colors hover:bg-surface-2 hover:text-fg";

/** The viewer fills its panel; what it shows scrolls inside. */
const VIEWER = "flex min-h-0 flex-1 flex-col";
const VIEWER_BODY = "min-h-0 flex-1";
const PRE = "m-0 h-full overflow-auto px-[18px] py-3.5 text-xs leading-[1.55] break-words whitespace-pre-wrap text-fg-2";
const FRAME = "block h-full min-h-[560px] w-full border-0 bg-white";

function Viewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const rawUrl = api.url("runs.file", { id, query: { name, raw: true } });

  if (ext === "html") {
    return (
      <div className={VIEWER}>
        <div className={VIEWER_BODY}>
          <iframe className={FRAME} src={rawUrl} sandbox="allow-scripts" allow="clipboard-write" title={name} />
        </div>
      </div>
    );
  }
  if (ext === "pdf") {
    // The browser's built-in PDF viewer; no sandbox — it would block the
    // viewer plugin, and the file is same-origin from the run folder.
    return (
      <div className={VIEWER}>
        <div className={VIEWER_BODY}>
          <iframe className={FRAME} src={rawUrl} title={name} />
        </div>
      </div>
    );
  }
  if (IMG.has(ext)) {
    return (
      <div className={VIEWER}>
        <div className={VIEWER_BODY}>
          <img className="block max-h-full max-w-full object-contain px-[18px] py-3.5" src={rawUrl} alt={name} />
        </div>
      </div>
    );
  }
  if (ext === "md" || ext === "markdown") return <MarkdownViewer id={id} name={name} live={live} />;
  return <TextViewer id={id} name={name} live={live} />;
}

/** A thin line above the viewer: a toggle, a truncation note. */
const VIEWER_NOTE = "flex items-center gap-3 border-b border-line/55 px-[18px] py-1.5 text-2xs text-fg-2";

function MarkdownViewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const data = useApi("runs.fileText", { id, query: { name } }, { fast: live });
  // Artifacts are model-generated — sanitize before injecting into the page.
  const html = useMemo(
    () => (data ? DOMPurify.sanitize(marked.parse(data.content, { async: false })) : ""),
    [data?.content]
  );
  return (
    <div className={VIEWER}>
      <div className={VIEWER_NOTE}>
        <Tabs
          className="border-b-0 px-0"
          label="markdown view"
          value={mode}
          onChange={setMode}
          items={[
            { id: "rendered", label: "rendered" },
            { id: "source", label: "source" },
          ]}
        />
        {data?.truncated && <span>large file — showing the last {fmtSize(400_000)}</span>}
      </div>
      <div className={cn(VIEWER_BODY, "overflow-auto")}>
        {!data ? (
          <pre className={PRE}>loading…</pre>
        ) : mode === "rendered" ? (
          <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className={PRE}>{data.content || "(empty)"}</pre>
        )}
      </div>
    </div>
  );
}

function TextViewer({ id, name, live }: { id: string; name: string; live: boolean }) {
  const data = useApi("runs.fileText", { id, query: { name } }, { fast: live });
  return (
    <div className={VIEWER}>
      {data?.truncated && <div className={VIEWER_NOTE}>large file — showing the last {fmtSize(400_000)}</div>}
      <div className={VIEWER_BODY}>
        <pre className={PRE}>{data ? data.content || "(empty)" : "loading…"}</pre>
      </div>
    </div>
  );
}
