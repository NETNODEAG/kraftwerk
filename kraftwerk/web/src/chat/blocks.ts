/** The thread's blocks: the event log replayed into messages, activity, plans, failures and requests. */
import type {
  Attachment,
  Author,
  Compaction,
  ElicitationField,
  PlanEntry,
  SessionFailure,
  StoredChatEvent,
} from "../types";

/** Rendered thread block. */
export type Block =
  | { kind: "user"; text: string; steered?: boolean; attachments?: Attachment[]; key: string; from?: Author }
  | { kind: "agent"; text: string; key: string; from?: Author }
  | { kind: "thought"; text: string; key: string; from?: Author }
  | { kind: "tool"; callId: string; title: string; toolKind?: string; status?: string; compaction?: Compaction; key: string; from?: Author }
  /** A subagent's own stream, nested under the card that announced it. */
  | { kind: "subagent"; sessionId: string; name: string; task: string; state?: string; children: Block[]; key: string; from?: Author }
  /** Background work: lives on after the tool call that started it. */
  | { kind: "task"; taskId: string; name: string; taskType: string; description: string; summary?: string; state?: string; canStop?: boolean; key: string; from?: Author }
  | {
      kind: "permission";
      requestId: string;
      title: string;
      options: Array<{ optionId: string; name: string; kind?: string }>;
      resolved: string | null | undefined; // undefined = pending
      key: string;
      from?: Author;
    }
  | { kind: "error"; text: string; key: string; from?: Author }
  /** A session failure the harness reported; `resolved` once a later turn ended, `retryText` is the message to send again. */
  | { kind: "failure"; failure: SessionFailure; resolved: boolean; retryText?: string; key: string; from?: Author }
  /** The agent's plan, updated in place; `removed` once the agent dropped it. */
  | { kind: "plan"; entries: PlanEntry[]; removed: boolean; key: string; from?: Author }
  | { kind: "files"; paths: string[]; complete: boolean; note?: string; key: string; from?: Author }
  | {
      kind: "question";
      requestId: string;
      message: string;
      fields: ElicitationField[];
      /** undefined = waiting for an answer */
      resolved?: { action: string; content?: Record<string, unknown> };
      key: string;
      from?: Author;
    };

export const sameAuthor = (a?: Author, b?: Author): boolean =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && (a.kind === "human" ? a.name === (b as { name: string }).name : a.slug === (b as { slug: string }).slug));

export function toBlocks(events: StoredChatEvent[]): Block[] {
  const root: Block[] = [];
  const toolIndex = new Map<string, Extract<Block, { kind: "tool" }>>();
  const subIndex = new Map<string, Extract<Block, { kind: "subagent" }>>();
  const taskIndex = new Map<string, Extract<Block, { kind: "task" }>>();
  const failIndex = new Map<string, Extract<Block, { kind: "failure" }>>();
  const questionIndex = new Map<string, Extract<Block, { kind: "question" }>>();
  const permIndex = new Map<string, number>();
  let lastUserText: string | undefined;
  let plan: Extract<Block, { kind: "plan" }> | undefined;
  for (const ev of events) {
    // A subagent's events nest under its card; an unknown child falls back to the thread.
    const owner = "subagent" in ev && ev.subagent ? subIndex.get(ev.subagent) : undefined;
    const blocks = owner ? owner.children : root;
    const last = blocks[blocks.length - 1];
    switch (ev.type) {
      case "user_message":
        lastUserText = ev.text;
        blocks.push({ kind: "user", text: ev.text, steered: ev.steered, attachments: ev.attachments, key: `e${ev.seq}`, from: ev.from });
        break;
      case "text":
        if (last?.kind === "agent" && sameAuthor(last.from, ev.from)) last.text += ev.text;
        else blocks.push({ kind: "agent", text: ev.text, key: `e${ev.seq}`, from: ev.from });
        break;
      case "thought":
        if (last?.kind === "thought" && sameAuthor(last.from, ev.from)) last.text += ev.text;
        else blocks.push({ kind: "thought", text: ev.text, key: `e${ev.seq}`, from: ev.from });
        break;
      case "tool_call": {
        const b: Extract<Block, { kind: "tool" }> = {
          kind: "tool",
          callId: ev.callId,
          title: ev.title,
          toolKind: ev.kind,
          status: ev.status,
          compaction: ev.compaction,
          key: `e${ev.seq}`,
          from: ev.from,
        };
        toolIndex.set(ev.callId, b);
        blocks.push(b);
        break;
      }
      case "tool_update": {
        const b = toolIndex.get(ev.callId);
        if (b) {
          if (ev.title) b.title = ev.title;
          if (ev.status) b.status = ev.status;
          if (ev.compaction) b.compaction = { ...b.compaction, ...ev.compaction };
        }
        break;
      }
      case "subagent": {
        const b: Extract<Block, { kind: "subagent" }> = {
          kind: "subagent",
          sessionId: ev.sessionId,
          name: ev.name,
          task: ev.task,
          children: [],
          key: `e${ev.seq}`,
          from: ev.from,
        };
        subIndex.set(ev.sessionId, b);
        root.push(b);
        break;
      }
      case "subagent_state": {
        const b = subIndex.get(ev.sessionId);
        if (b) b.state = ev.state;
        break;
      }
      case "task": {
        const b: Extract<Block, { kind: "task" }> = {
          kind: "task",
          taskId: ev.taskId,
          name: ev.name,
          taskType: ev.taskType,
          description: ev.description,
          canStop: ev.canStop,
          state: "running",
          key: `e${ev.seq}`,
          from: ev.from,
        };
        taskIndex.set(ev.taskId, b);
        blocks.push(b);
        break;
      }
      case "task_update": {
        const b = taskIndex.get(ev.taskId);
        if (b) {
          if (ev.description) b.description = ev.description;
          if (ev.summary) b.summary = ev.summary;
          if (ev.state) b.state = ev.state;
        }
        break;
      }
      case "permission_request":
        permIndex.set(ev.requestId, blocks.length);
        blocks.push({
          kind: "permission",
          requestId: ev.requestId,
          title: ev.title,
          options: ev.options,
          resolved: undefined,
          key: `e${ev.seq}`,
          from: ev.from,
        });
        break;
      case "permission_resolved": {
        const i = permIndex.get(ev.requestId);
        if (i != null) (blocks[i] as Extract<Block, { kind: "permission" }>).resolved = ev.optionId;
        break;
      }
      case "error":
        blocks.push({ kind: "error", text: ev.message, key: `e${ev.seq}`, from: ev.from });
        break;
      case "failure": {
        const { type: _t, seq: _s, ts: _ts, from, ...failure } = ev;
        const existing = failIndex.get(failure.id);
        // The harness never says "resolved": a new revision replaces the
        // report in place, a later finished turn settles it.
        if (existing && failure.revision >= existing.failure.revision) {
          existing.failure = failure;
          existing.resolved = false;
          existing.retryText = lastUserText;
        } else if (!existing) {
          const b: Extract<Block, { kind: "failure" }> = { kind: "failure", failure, resolved: false, retryText: lastUserText, key: `e${ev.seq}`, from };
          failIndex.set(failure.id, b);
          root.push(b);
        }
        break;
      }
      case "turn_end":
        for (const b of failIndex.values()) b.resolved = true;
        break;
      case "plan":
        // One plan card per agent, in place: it first appears where the
        // agent wrote it and keeps updating there.
        if (ev.entries === null) {
          if (plan) plan.removed = true;
        } else if (plan && !plan.removed) {
          plan.entries = ev.entries;
        } else {
          plan = { kind: "plan", entries: ev.entries, removed: false, key: `e${ev.seq}`, from: ev.from };
          root.push(plan);
        }
        break;
      case "files_changed":
        if (ev.paths.length > 0 || ev.uncertainty) {
          root.push({
            kind: "files",
            paths: ev.paths,
            complete: ev.complete,
            ...(ev.uncertainty ? { note: ev.uncertainty } : {}),
            key: `e${ev.seq}`,
            from: ev.from,
          });
        }
        break;
      case "elicitation_request": {
        const b: Extract<Block, { kind: "question" }> = { kind: "question", requestId: ev.requestId, message: ev.message, fields: ev.fields, key: `e${ev.seq}`, from: ev.from };
        questionIndex.set(ev.requestId, b);
        root.push(b);
        break;
      }
      case "elicitation_resolved": {
        const b = questionIndex.get(ev.requestId);
        if (b) b.resolved = { action: ev.action, ...(ev.action === "accept" ? { content: ev.content } : {}) };
        break;
      }
      // turn_start, usage, commands, config, auth render nothing here (see liveState).
    }
  }
  return root;
}
