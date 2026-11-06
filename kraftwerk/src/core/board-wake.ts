import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { getAgent, listAgents } from "./agents.js";
import { EVENTS_FILE, type TaskEvent } from "./boards.js";
import { onChanged } from "./changes.js";
import { createChat, listChats, postMessage } from "./chat/sessions.js";
import { getOutputDir } from "./context.js";
import { chatHref, dismissKey, pushNotification } from "./notifications.js";
import { perWorkspace, workspaceOpen } from "./workspace.js";

/**
 * Waking agents for their tasks. boards.ts appends a TaskEvent line to
 * <output>/boards/events.jsonl whenever a task with an agent as assignee
 * sits in a work column after a change (created there, moved there,
 * assigned); this module, started by the server for every open workspace,
 * consumes the file: for each event it opens a session for the agent with
 * the task as its scope (ChatScope.task → the task block in its context,
 * unattended like a routine run) and posts why it was woken — or, when the
 * agent already has a live session for that task, posts into that one.
 *
 * The file is read past a remembered offset (<output>/boards/events.offset),
 * so every line is acted on once; it is rotated when it grows large. Writers
 * append whole lines (O_APPEND), so a half-written line never appears.
 */

const STATE_FILE = "boards/events.offset";
const ROTATE_OVER = 256 * 1024;
const FALLBACK_MS = 20_000;

const consumer = perWorkspace(() => ({
  timer: null as ReturnType<typeof setInterval> | null,
  watcher: null as FSWatcher | null,
  unsubscribe: null as null | (() => void),
  running: false,
  again: false,
}));

const eventsFile = (): string => path.join(getOutputDir(), EVENTS_FILE);
const offsetFile = (): string => path.join(getOutputDir(), STATE_FILE);

async function readOffset(): Promise<number> {
  const n = Number(await fs.readFile(offsetFile(), "utf8").catch(() => "0"));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Lines appended since the offset; the new offset. */
async function readNew(): Promise<{ events: TaskEvent[]; offset: number; size: number }> {
  const file = eventsFile();
  const st = await fs.stat(file).catch(() => null);
  if (!st) return { events: [], offset: 0, size: 0 };
  let offset = await readOffset();
  if (offset > st.size) offset = 0; // the file was rotated or replaced
  if (offset === st.size) return { events: [], offset, size: st.size };
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(st.size - offset);
    await fh.read(buf, 0, buf.length, offset);
    const text = buf.toString("utf8");
    const complete = text.lastIndexOf("\n");
    if (complete < 0) return { events: [], offset, size: st.size };
    const events: TaskEvent[] = [];
    for (const line of text.slice(0, complete).split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as TaskEvent);
      } catch {
        /* a broken line is skipped, not retried forever */
      }
    }
    return { events, offset: offset + complete + 1, size: st.size };
  } finally {
    await fh.close();
  }
}

/** Keep the file small: once everything is consumed and it is big, start over (a writer racing the rename lands in the new file). */
async function rotate(offset: number, size: number): Promise<void> {
  if (size < ROTATE_OVER || offset < size) return;
  await fs.rename(eventsFile(), `${eventsFile()}.old`).catch(() => {});
  await fs.rm(`${eventsFile()}.old`, { force: true }).catch(() => {});
  await fs.writeFile(offsetFile(), "0");
}

/** The message the agent gets: why it was woken, in one paragraph; the task itself is in its context block. */
function wakeMessage(ev: TaskEvent, resumed: boolean): string {
  const who = ev.actor.replace(/^human:/, "");
  const why =
    ev.reason === "created"
      ? `Task ${ev.task} ("${ev.title}") was created for you by ${who}`
      : ev.reason === "assigned"
        ? `Task ${ev.task} ("${ev.title}") was handed to you by ${who}`
        : `Task ${ev.task} ("${ev.title}") was moved to ${ev.status} for you by ${who}`;
  return (
    `${why}${ev.message ? `: ${ev.message}` : "."}\n` +
    (resumed
      ? `Continue with it: read the task's log for what changed (\`npx kraftwerk tasks show ${ev.task} ${cliFlags(ev)}\`).`
      : `It is in ${ev.status}. Read the task block in your context (task.md, files, log), move it to the work column when you start, log what you do, and hand it to review when done.`)
  );
}

const cliFlags = (ev: TaskEvent): string => (ev.project ? `--project ${ev.project} --board ${ev.board}` : `--board ${ev.board}`);

/** A chat on the task page: the agent's task session (scope.task) or a chat tagged with the task (meta.task, "work on this"). */
export interface TaskSession {
  id: string;
  /** The agent slug of a task session; "claude" | "codex" | "pi" for a plain chat tagged with the task. */
  agent: string;
  /** The agent's display name and emoji when it is one of the workspace's agents. */
  name?: string;
  emoji?: string;
  title: string;
  updatedAt: string;
  busy: boolean;
  /** The chat's route in the UI (#/agents/<slug>/chat/<id>, #/projects/<p>/chat/<id>, …). */
  href: string;
}

const taskOf = (c: { scope: { kind: string; task?: string }; task?: string }): string | undefined => c.task ?? (c.scope.kind === "agent" ? c.scope.task : undefined);

/** The sessions that worked on a task, newest first: what the task page links the log's actors to. */
export async function taskSessions(ref: string): Promise<TaskSession[]> {
  const [chats, agents] = await Promise.all([listChats(), listAgents().catch(() => [])]);
  return chats
    .filter((c) => taskOf(c) === ref)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((c) => {
      const slug = c.scope.kind === "agent" ? c.scope.slug : c.agent;
      const def = agents.find((a) => a.slug === slug);
      return { id: c.id, agent: slug, ...(def ? { name: def.name, emoji: def.emoji } : {}), title: c.title, updatedAt: c.updatedAt, busy: c.busy, href: chatHref(c) };
    });
}

/** One event: post into the agent's live session for this task, or open one. */
async function wake(ev: TaskEvent): Promise<void> {
  const def = await getAgent(ev.agent);
  if (!def) throw new Error(`agent "${ev.agent}" not found`);
  const existing = (await listChats()).find((c) => c.scope.kind === "agent" && c.scope.slug === ev.agent && c.scope.task === ev.ref);
  // Already on it (a turn is running in its session for this task): the agent reads the log when it looks; no second session.
  if (existing?.busy) return;
  const meta =
    existing ??
    (await createChat({
      agent: def.harness,
      scope: { kind: "agent", slug: ev.agent, task: ev.ref },
      title: `📋 ${ev.task}`,
      ...(ev.project ? { project: ev.project } : {}),
    }));
  const { error } = await postMessage(meta.id, wakeMessage(ev, !!existing));
  if (error) throw new Error(error);
  await dismissKey(`task-wake:${ev.ref}`);
  await pushNotification({
    kind: "task_woken",
    title: `📋 ${ev.task} → ${def.emoji} ${def.name}`,
    body: ev.message ?? ev.title,
    href: chatHref(meta),
    key: `task-woken:${ev.ref}:${ev.agent}`,
  }).catch(() => {});
}

/** Consume what was appended since the last run. Serialised: a run that overlaps is queued, never doubled. */
export async function consumeTaskEvents(): Promise<number> {
  const c = consumer();
  if (c.running) {
    c.again = true;
    return 0;
  }
  c.running = true;
  let handled = 0;
  try {
    const { events, offset, size } = await readNew();
    if (events.length) {
      // The offset moves first: an event that keeps failing must not be retried on every tick.
      await fs.mkdir(path.dirname(offsetFile()), { recursive: true });
      await fs.writeFile(offsetFile(), String(offset));
      // The same task for the same agent twice in one batch (assign, then move): the last reason wins.
      const latest = new Map<string, TaskEvent>();
      for (const ev of events) latest.set(`${ev.ref}:${ev.agent}`, ev);
      for (const ev of latest.values()) {
        try {
          await wake(ev);
          handled++;
        } catch (err) {
          await pushNotification({
            kind: "task_wake_failed",
            title: `📋 ${ev.task}: ${ev.agent} could not be started`,
            body: (err as Error).message,
            href: ev.project ? `/projects/${ev.project}/boards/${ev.board}/${ev.task}` : `/boards/${ev.board}/${ev.task}`,
            key: `task-wake:${ev.ref}`,
          }).catch(() => {});
        }
      }
    }
    await rotate(offset, size);
  } finally {
    c.running = false;
    if (c.again) {
      c.again = false;
      void consumeTaskEvents().catch(() => {});
    }
  }
  return handled;
}

/** Start consuming the current workspace's task events: on every change signal, on file changes, and every FALLBACK_MS anyway. */
export function startBoardWake(): void {
  const c = consumer();
  if (c.timer) return;
  const kick = (): void => {
    if (!workspaceOpen()) return;
    void consumeTaskEvents().catch(() => {});
  };
  c.timer = setInterval(kick, FALLBACK_MS);
  c.timer.unref?.();
  c.unsubscribe = onChanged(kick);
  const dir = path.dirname(eventsFile());
  void fs.mkdir(dir, { recursive: true }).then(() => {
    if (!c.timer || c.watcher) return;
    try {
      c.watcher = watch(dir, { persistent: false }, kick);
      c.watcher.on("error", () => {});
    } catch {
      /* no watcher: the interval still runs */
    }
  });
  kick();
}

export function stopBoardWake(): void {
  const c = consumer();
  if (c.timer) clearInterval(c.timer);
  c.timer = null;
  c.unsubscribe?.();
  c.unsubscribe = null;
  c.watcher?.close();
  c.watcher = null;
}
