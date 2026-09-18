import { useCallback, useEffect, useState } from "react";
import { listRuns, type RunListItem } from "./api";

/**
 * A run started with Run! in this UI. It is remembered until its result has
 * been handed to the chat, so a run that ends while the tab is closed is
 * still reported on the next visit.
 */
export interface UiRun {
  id: string;
  workflow: string;
  request: string;
  at: number;
}

/** First line of the message that reports a run to the chat; the thread renders such a message as a card. */
export const RUN_MARK = "[workflow run] ";

export const runEnded = (run: RunListItem | undefined): run is RunListItem =>
  !!run && run.status !== "running" && !run.awaitingDecision;

/** How a run reads to someone who did not write the workflow. */
export function runLine(run: RunListItem | undefined): { text: string; tone: "live" | "ok" | "bad" | "ask" } {
  if (!run) return { text: "starting…", tone: "live" };
  if (run.awaitingDecision) return { text: "needs your decision", tone: "ask" };
  if (run.status === "running") {
    const at = run.phasesTotal ? `step ${Math.min(run.phasesDone + 1, run.phasesTotal)} of ${run.phasesTotal}` : "running";
    return { text: run.currentPhase ? `${at} · ${run.currentPhase}` : at, tone: "live" };
  }
  if (run.status === "ok") return { text: "done", tone: "ok" };
  return { text: run.currentPhase ? `failed at ${run.currentPhase}` : "failed", tone: "bad" };
}

/**
 * What the chat's agent is told once a run has ended. A general chat knows
 * nothing about kraftwerk, so the message carries the run folder itself.
 */
export function runReport(ui: UiRun, run: RunListItem, outputDir: string): string {
  const folder = ui.id.startsWith("run-") ? `${outputDir}/${ui.id}` : `${outputDir}/runs/${ui.id}`;
  const ask =
    run.status === "ok"
      ? "I started this run from the workflows list. Show me the result."
      : "I started this run from the workflows list and it did not finish. Tell me what went wrong and what to do about it.";
  return [
    `${RUN_MARK}${ui.workflow} · ${runLine(run).text}`,
    ...(ui.request ? [`Request: ${ui.request.replace(/\s+/g, " ")}`] : []),
    `Run folder: ${folder}`,
    "",
    ask,
  ].join("\n");
}

/** The run list: quick while one is live, slow otherwise; `refresh` polls right away. */
export function useRuns(): { runs: RunListItem[] | null; outputDir: string; refresh: () => void } {
  const [state, setState] = useState<{ runs: RunListItem[] | null; outputDir: string }>({ runs: null, outputDir: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const next = await listRuns().catch(() => null);
      if (!alive) return;
      if (next) setState(next);
      timer = setTimeout(poll, next?.runs.some((r) => r.status === "running") ? 2_000 : 10_000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tick]);

  return { ...state, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

/** The runs still owed to the chat, kept per workspace in this browser. */
export function usePendingRuns(workspaceKey: string): [UiRun[], (update: (prev: UiRun[]) => UiRun[]) => void] {
  const key = `kw-next-pending:${workspaceKey}`;
  const [pending, setPending] = useState<UiRun[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(pending));
    } catch {
      /* without storage the report still happens while the tab stays open */
    }
  }, [key, pending]);
  return [pending, setPending];
}
