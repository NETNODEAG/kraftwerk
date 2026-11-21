import { getAgent } from "../core/agents.js";
import { emitTaskEvent, setCloudTaskContext } from "../core/boards.js";
import { cloudPost } from "../core/cloud.js";
import { log } from "../core/log.js";
import { pushNotification } from "../core/notifications.js";
import { getCloudBoard, getCloudTask } from "./cloud-boards.js";
import { cloudStatus, inServedWorkspace, machineLink, onCloudChanged, onEventsWaiting } from "./cloud.js";

/**
 * What kraftwerk cloud has for this machine (its machine-events.ts): a task
 * on a cloud board handed to the person this machine belongs to, or a task
 * for one of the workspace's agents.
 *
 * Event-driven: while the machine is connected and claimed it holds an event
 * stream to the cloud (/api/machines/stream, below; independent of remote
 * access), and the cloud pokes it there ({t:"poke"}, no content) — or over
 * the relay socket when remote access is on (relay.ts). The heartbeat says
 * how many wait in case a poke was missed (cloud.ts). Either way
 * fetchCloudEvents runs, once at a time.
 *
 *   task_assigned  a notification in that workspace — the bell, the browser,
 *                  a paired phone — that leads to the task
 *   agent_task     when the agent is in that workspace here, the machine claims
 *                  the task (the first machine to claim it wins, so clones
 *                  never both work on it) and wakes the agent through the same
 *                  path a local board uses (board-wake.ts) — its session has
 *                  the task as context and works it with `tasks … --board @<board>`
 *
 * Everything fetched is acknowledged: an event is acted on once per machine.
 */

interface CloudEvent {
  id: number;
  workspaceId: string;
  kind: "task_assigned" | "agent_task";
  agent?: string;
  person?: string;
  board: string;
  boardTitle: string;
  number: number;
  title: string;
  status: string;
  by: string;
  reason: "assigned" | "moved" | "created";
  message?: string;
  at: number;
}

let running: Promise<void> | null = null;
let again = false;

/** Fetch and act on what waits; a call while one runs makes it run once more after. */
export function fetchCloudEvents(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await round();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function round(): Promise<void> {
  const link = machineLink();
  if (!link) return;
  const auth = { id: link.creds.id, secret: link.creds.secret };
  let events: CloudEvent[];
  try {
    events = (await cloudPost<{ events: CloudEvent[] }>(link.url, "/api/machines/events", auth, { version: link.version })).events ?? [];
  } catch (err) {
    log("warn", "cloud", `could not fetch events: ${(err as Error).message}`);
    return;
  }
  if (!events.length) return;
  const ack: number[] = [];
  const claim: { ev: CloudEvent; agentHere: boolean }[] = [];
  for (const ev of events) {
    if (ev.kind === "task_assigned") {
      await inServedWorkspace(ev.workspaceId, () => notifyAssigned(ev)).catch(() => null);
      ack.push(ev.id);
    } else {
      const here = await inServedWorkspace(ev.workspaceId, async () => !!(ev.agent && (await getAgent(ev.agent).catch(() => null)))).catch(() => null);
      if (here?.value) claim.push({ ev, agentHere: true });
      else ack.push(ev.id);
    }
  }
  let claimed: number[] = [];
  try {
    claimed = (await cloudPost<{ claimed: number[] }>(link.url, "/api/machines/events/ack", { ...auth, ack, claim: claim.map((c) => c.ev.id) }, { version: link.version })).claimed ?? [];
  } catch (err) {
    log("warn", "cloud", `could not acknowledge events: ${(err as Error).message}`);
    return;
  }
  for (const { ev } of claim) {
    if (!claimed.includes(ev.id)) continue; // another machine with the agent took it
    await inServedWorkspace(ev.workspaceId, () => wakeFor(ev)).catch((err: Error) => log("warn", "cloud", `could not wake ${ev.agent} for @${ev.board}/${ev.number}: ${err.message}`));
  }
}

const who = (actor: string): string => actor.replace(/^human:/, "");

async function notifyAssigned(ev: CloudEvent): Promise<void> {
  await pushNotification({
    kind: "task_assigned",
    title: `📋 ${who(ev.by)} gave you “${ev.title}”`,
    body: `${ev.boardTitle} · ${ev.status}${ev.message ? ` — ${ev.message}` : ""}`,
    href: `/boards/@${ev.board}/${ev.number}`,
    key: `task-assigned:@${ev.board}/${ev.number}`,
  });
}

/** The agent's wake, as for a local board: a TaskEvent board-wake.ts consumes. */
async function wakeFor(ev: CloudEvent): Promise<void> {
  await emitTaskEvent({
    at: new Date(ev.at).toISOString(),
    ref: `@${ev.board}/${ev.number}`,
    board: `@${ev.board}`,
    task: String(ev.number),
    title: ev.title,
    agent: ev.agent!,
    status: ev.status,
    reason: ev.reason,
    actor: ev.by,
    ...(ev.message ? { message: ev.message } : {}),
  });
}

/** The context block of a cloud task for the agent woken for it (core/boards.ts taskContext). */
async function cloudContext(reference: string): Promise<string> {
  const [board, n] = reference.split("/");
  const flags = `--board ${board}`;
  try {
    const [t, b] = await Promise.all([getCloudTask({ kind: "local" }, board, n), getCloudBoard({ kind: "local" }, board).catch(() => null)]);
    const cols = b ? b.columns.map((c) => c.slug).join(", ") : "";
    return (
      `## Your task: ${t.number} ${t.title}\n` +
      `Cloud board ${board}${b ? ` (columns: ${cols})` : ""} — kept in kraftwerk cloud, shared with everyone on the workspace; status ${t.status}${t.assignee ? `, assigned to ${t.assignee}` : ""}${t.due ? `, due ${t.due}` : ""}.\n` +
      `\n### Notes\n${t.notes.trim() || "(none — ask in the log what done looks like)"}\n` +
      `\n### Log (newest first)\n${t.log.trim() || "(empty)"}\n\n` +
      `Work it through the CLI (${flags}, the number ${t.number} names the task): \`npx kraftwerk tasks move ${t.number} doing ${flags}\` when you start, ` +
      `\`tasks log ${t.number} "<what you did>" ${flags}\` as you go (files into $KRAFTWERK_TEMP or the workspace), ` +
      `\`tasks assign ${t.number} <agent or human:handle> -m "<note>" ${flags}\` to hand it over, \`tasks move ${t.number} review -m "<summary>" ${flags}\` when done. Never move it to a finished column.`
    );
  } catch (err) {
    return `You were opened for task ${reference} on a cloud board, but it could not be read (${(err as Error).message}). Try \`npx kraftwerk tasks show ${n} ${flags}\`.`;
  }
}

/* ---------- the event stream ---------- */

const PING_MS = 30_000;
const stream = {
  ws: null as WebSocket | null,
  /** The link it was opened for: url + machine id; another one closes it. */
  key: "",
  retry: null as ReturnType<typeof setTimeout> | null,
  ping: null as ReturnType<typeof setInterval> | null,
  backoff: 1_000,
};

function closeStream(): void {
  if (stream.retry) clearTimeout(stream.retry);
  if (stream.ping) clearInterval(stream.ping);
  stream.retry = null;
  stream.ping = null;
  const ws = stream.ws;
  stream.ws = null;
  stream.key = "";
  try {
    ws?.close();
  } catch {}
}

/** Hold the stream while connected and claimed; drop it otherwise. */
export function keepEventStream(): void {
  const link = machineLink();
  const st = cloudStatus();
  const want = link && st.state === "connected" && st.account ? `${link.url} ${link.creds.id}` : "";
  if (want === stream.key && (stream.ws || stream.retry)) return;
  closeStream();
  if (!want || !link || typeof WebSocket === "undefined") return;
  stream.key = want;
  const ws = new WebSocket(`${link.url.replace(/^http/, "ws")}/api/machines/stream`);
  stream.ws = ws;
  ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "auth", id: link.creds.id, secret: link.creds.secret })));
  ws.addEventListener("message", (ev) => {
    let msg: { t?: string };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.t === "ok") {
      stream.backoff = 1_000;
      stream.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "ping" })), PING_MS);
      stream.ping.unref?.();
      // What came in while there was no stream.
      void fetchCloudEvents().catch(() => {});
    } else if (msg.t === "poke") void fetchCloudEvents().catch(() => {});
  });
  ws.addEventListener("close", () => {
    if (stream.ws !== ws) return;
    if (stream.ping) clearInterval(stream.ping);
    stream.ping = null;
    stream.ws = null;
    // Gone (the cloud restarted, the network changed): again soon, slower each time; a refused auth waits for the next change.
    stream.retry = setTimeout(() => {
      stream.retry = null;
      stream.key = "";
      keepEventStream();
    }, stream.backoff);
    stream.retry.unref?.();
    stream.backoff = Math.min(stream.backoff * 2, 60_000);
  });
  ws.addEventListener("error", () => {});
}

/** Whether the stream is up (tests, status). */
export const eventStreamOpen = (): boolean => stream.ws?.readyState === 1;

/** Hook in (cloud.ts startMachineCloud): the task context, the heartbeat's count, the link's changes. Not at import — the modules load each other. */
export function installCloudEvents(): void {
  setCloudTaskContext(cloudContext);
  onEventsWaiting(fetchCloudEvents);
  onCloudChanged(keepEventStream);
}
