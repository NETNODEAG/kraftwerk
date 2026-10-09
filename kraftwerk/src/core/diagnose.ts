import path from "node:path";
import { getOutputDir } from "./context.js";
import { getAgent } from "./agents.js";
import { getRun, type RunDetail } from "./runs.js";
import { listRoutines } from "./routines.js";
import { createChat, getChat, postMessage } from "./chat/sessions.js";
import type { ChatAgentId, ChatScope } from "./chat/types.js";
import { chatHref, getNotification, markNotificationsRead, type DiagnoseRef } from "./notifications.js";

/**
 * "Diagnose" on a failure item in the bell: open a chat in the place that
 * knows most about the failure and hand it a first message that asks for
 * root cause and a fix.
 *
 *   workflow run failed  -> run chat (cwd = run folder, project root granted)
 *   routine session died -> a fresh session of the same agent, pointed at the
 *                           failed session's event log
 *   routine could not start -> kraftwerk-aware chat (the agent/harness setup is the problem)
 *
 * The prompt is built here, at click time, so it reflects the run's final
 * state, and the chat shows it as the user's own first message — nothing
 * hidden.
 */

export interface DiagnosePlan {
  agent: ChatAgentId;
  scope: ChatScope;
  title: string;
  prompt: string;
}

const FIX_INSTRUCTIONS =
  `Work in this order:\n` +
  `1. Find the root cause. Read the evidence before guessing, and say in plain words what went wrong and where.\n` +
  `2. Decide whether the fix belongs in the workflow definition (prompts, steps, gates, agent configs), in the project, ` +
  `or outside (credentials, network, a missing tool). Say which.\n` +
  `3. If the fix is in the workflow or project files, apply it and show the diff. If it is outside, say exactly what the user must do.\n` +
  `4. End with how to verify: the command to re-run, and what a good result looks like.`;

function runPrompt(run: RunDetail): string {
  const phases = run.phases
    .map((p) => `- ${p.phase} [${p.status}]${p.summary ? `: ${p.summary}` : ""}`)
    .join("\n");
  const failedPhase = run.phases.find((p) => p.status === "failed" || p.status === "blocked");
  return (
    `Workflow run ${run.id} of "${run.workflow ?? "?"}" ended with status ${run.status}` +
    (failedPhase ? ` in phase "${failedPhase.phase}" (${failedPhase.status})` : "") +
    `.\nRequest: ${run.request ?? "(none)"}\n\nPhases:\n${phases || "(none)"}\n\n` +
    `Please diagnose this run. The evidence is in this folder: trace.jsonl (every event), trigger.log ` +
    `(process output), and the phase outputs. The workflow definition lives in the project root, which you may edit.\n\n` +
    FIX_INSTRUCTIONS +
    `\nRe-run with: KRAFTWERK_YES=1 npx kraftwerk run ${run.workflow ?? "<workflow>"} "${(run.request ?? "").replace(/"/g, '\\"')}"`
  );
}

async function routinePrompt(ref: Extract<DiagnoseRef, { kind: "routine" }>, agentExists: boolean): Promise<string> {
  const routine = (await listRoutines(ref.agent).catch(() => []))
    .find((r) => r.id === ref.routine);
  const head = routine
    ? `The routine "${routine.name}" (schedule ${routine.schedule}) of agent "${ref.agent}" failed.\nIts prompt was:\n"""\n${routine.prompt}\n"""\n`
    : `A routine (${ref.routine}) of agent "${ref.agent}" failed.\n`;
  let evidence: string;
  if (ref.chatId) {
    const chat = await getChat(ref.chatId).catch(() => null);
    const errors = chat?.events.filter((e) => e.type === "error").map((e) => (e as { message: string }).message) ?? [];
    evidence =
      `The failed session's full event log is ${path.join(getOutputDir(), "chats", ref.chatId, "events.jsonl")} ` +
      `(one JSON event per line: user_message, text, tool_call, error, turn_end).` +
      (errors.length ? `\nErrors recorded:\n${errors.map((m) => `- ${m}`).join("\n")}` : "");
  } else {
    evidence = agentExists
      ? `The session could not even start. Check the agent's definition under agents/${ref.agent}/ (agent.yml, routines.yml) and whether its harness is installed and authenticated.`
      : `The session could not start because agent "${ref.agent}" was not found — check agents/${ref.agent}/agent.yml and the routine in agents/${ref.agent}/routines.yml.`;
  }
  return `${head}\n${evidence}\n\nPlease diagnose this failure.\n\n${FIX_INSTRUCTIONS}\nRe-run from the agent page ("run" next to the routine) or wait for the next scheduled time.`;
}

/** Where and how the diagnosis chat starts, for a failure item's reference. */
export async function diagnosePlan(ref: DiagnoseRef, title: string): Promise<DiagnosePlan | null> {
  if (ref.kind === "run") {
    const run = await getRun(ref.runId).catch(() => null);
    if (!run) return null;
    return { agent: "claude", scope: { kind: "run", runId: run.id }, title: `🩺 ${title}`, prompt: runPrompt(run) };
  }
  const def = await getAgent(ref.agent).catch(() => null);
  const prompt = await routinePrompt(ref, !!def);
  // A session that died mid-run: the agent itself looks at its own log.
  // No session at all (agent or harness broken): the kraftwerk-aware chat.
  const scope: ChatScope = def && ref.chatId ? { kind: "agent", slug: def.slug } : { kind: "kraftwerk" };
  return { agent: def && ref.chatId ? def.harness : "claude", scope, title: `🩺 ${title}`, prompt };
}

/** Create the chat, send the first message, mark the item read. */
export async function startDiagnosis(
  notificationId: string
): Promise<{ chatId: string; href: string } | { error: string; status: number }> {
  const item = await getNotification(notificationId);
  if (!item) return { error: "notification not found", status: 404 };
  if (!item.diagnose) return { error: "nothing to diagnose for this item", status: 409 };
  const plan = await diagnosePlan(item.diagnose, item.title);
  if (!plan) return { error: "the run this item refers to is gone", status: 410 };
  const meta = await createChat({ agent: plan.agent, scope: plan.scope, title: plan.title });
  const { error } = await postMessage(meta.id, plan.prompt);
  if (error) return { error, status: 409 };
  void markNotificationsRead([item.id]);
  return { chatId: meta.id, href: chatHref(meta) };
}
