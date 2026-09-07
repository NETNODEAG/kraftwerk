import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  Agent,
  AgentCommand,
  Attachment,
  AuthStatus,
  Author,
  Channel,
  ChatAgentId,
  ChatMeta,
  ChatScope,
  Compaction,
  ConfigOption,
  ElicitationField,
  PlanEntry,
  SessionFailure,
  SkillInfo,
  StoredChatEvent,
} from "./types";
import { Icon, Link, navigate, setPageTitle, useExpertMode, useFeatures } from "./shared";
import { VibeOffNote, VibePane, VibePicker } from "./vibeables";
import { AddCoworkerDialog } from "./channels";

/** The name a human posts under in channels; per browser, changeable in the composer. */
const ME_KEY = "kw-me";
export function myName(): string {
  try {
    return localStorage.getItem(ME_KEY) || "";
  } catch {
    return "";
  }
}
function setMyName(name: string): void {
  try {
    localStorage.setItem(ME_KEY, name);
  } catch {}
}

/**
 * Chat building blocks: the thread view (event-log replay — text chunks
 * merge into agent messages, tool calls render as activity cards,
 * permission requests as decision cards with buttons), the new-chat pane,
 * and the composer. General chats live on the agent screen under the
 * "General Chats" entry; history comes from GET /api/chats/:id, live
 * events stream over SSE.
 */

const AGENTS: Array<{ id: ChatAgentId; label: string; hint: string }> = [
  { id: "claude", label: "claude", hint: "Claude Code via ACP" },
  { id: "codex", label: "codex", hint: "Codex (ChatGPT) via ACP" },
  { id: "pi", label: "pi", hint: "pi coding agent" },
];

/* ---------- new chat ---------- */

export async function createChatAndOpen(
  agent: ChatAgentId,
  scope: { kind: string; runId?: string; bundle?: string; slug?: string },
  resume?: string
): Promise<void> {
  const res = await fetch("/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, scope, ...(resume ? { resume } : {}) }),
  });
  const meta = await res.json();
  if (meta.id) {
    navigate(
      meta.scope?.kind === "agent"
        ? `/agents/${encodeURIComponent(meta.scope.slug)}/chat/${meta.id}`
        : `/agents/chats/${meta.id}`
    );
  }
}

type AgentSession = { sessionId: string; title?: string; updatedAt?: string; cwd: string };

export function NewChat() {
  const [agent, setAgent] = useState<ChatAgentId>("claude");
  const [kraftwerkAware, setKraftwerkAware] = useState(true);
  const [creating, setCreating] = useState(false);
  // The agent's own sessions (Claude Code / Codex transcripts in the
  // project): any of them can continue as a chat. Loaded on demand — it
  // spawns the adapter briefly.
  const [sessions, setSessions] = useState<AgentSession[] | null | "loading">(null);
  useEffect(() => setSessions(null), [agent]);

  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>new chat</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">agent</span>
        </div>
        <div className="agent-pick">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              className={`agent-pick-btn ${agent === a.id ? "active" : ""}`}
              onClick={() => setAgent(a.id)}
            >
              <b>{a.label}</b>
              <span>{a.hint}</span>
            </button>
          ))}
        </div>
        <div className="run-opts" style={{ padding: "0 16px 14px" }}>
          <label>
            <input
              type="checkbox"
              checked={kraftwerkAware}
              onChange={(e) => setKraftwerkAware(e.target.checked)}
            />
            kraftwerk-aware
            <span className="opt-hint">— agent gets workflows + recent runs as context</span>
          </label>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <button
            className="run-btn"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen(agent, { kind: kraftwerkAware ? "kraftwerk" : "general" });
              setCreating(false);
            }}
          >
            {creating ? "starting…" : "start chat"}
          </button>
        </div>
      </section>
      {agent !== "pi" && (
        <section className="panel new-chat-panel">
          <div className="panel-head">
            <span className="microlabel">continue a session</span>
            <span className="spacer" />
            {sessions === null && (
              <button
                className="ws-btn"
                onClick={async () => {
                  setSessions("loading");
                  const d = await fetch(`/api/agent-sessions?agent=${agent}`)
                    .then((r) => (r.ok ? r.json() : { sessions: [] }))
                    .catch(() => ({ sessions: [] }));
                  setSessions((d.sessions ?? []).slice(0, 20));
                }}
              >
                <Icon name="history" className="ms-sm" /> list {agent} sessions
              </button>
            )}
          </div>
          {sessions === "loading" && <div className="empty">asking {agent}…</div>}
          {Array.isArray(sessions) && sessions.length === 0 && <div className="empty">no {agent} sessions in this project</div>}
          {Array.isArray(sessions) && sessions.length > 0 && (
            <div className="session-list">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  className="session-row"
                  disabled={creating}
                  title={s.sessionId}
                  onClick={async () => {
                    setCreating(true);
                    await createChatAndOpen(agent, { kind: kraftwerkAware ? "kraftwerk" : "general" }, s.sessionId);
                    setCreating(false);
                  }}
                >
                  <span className="session-title">{s.title || s.sessionId.slice(0, 8)}</span>
                  {s.updatedAt && <span className="session-when">{new Date(s.updatedAt).toLocaleString()}</span>}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Interrupt one agent (channels) or every agent in a chat. */
function stopAgent(chatId: string, agent?: string): void {
  void fetch(`/api/chats/${chatId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent ? { agent } : {}),
  }).catch(() => {});
}

const oneLine = (s: string, max = 90) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * A channel member's headline: `task` is the message that last addressed
 * it (what it works on), `now` its latest step in the running turn (the
 * tool it is using, else the start of what it is saying).
 */
function agentActivity(events: StoredChatEvent[], slug: string): { task?: string; now?: string } {
  const mention = new RegExp(`(^|[^a-z0-9-])@${slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?![a-z0-9-])`, "i");
  let task: string | undefined;
  let now: string | undefined;
  let open = false;
  let said = "";
  for (const e of events) {
    const mine = e.from?.kind === "agent" && e.from.slug === slug;
    if (!mine) {
      if ((e.type === "user_message" || e.type === "text") && mention.test(e.text)) task = oneLine(e.text);
      continue;
    }
    switch (e.type) {
      case "turn_start":
        open = true;
        now = undefined;
        said = "";
        break;
      case "turn_end":
      case "error":
        open = false;
        break;
      case "tool_call":
        if (open) now = oneLine(`${e.kind && e.kind !== "other" ? `${e.kind}: ` : ""}${e.title}`);
        break;
      case "text":
        if (open) {
          said += e.text;
          if (!now || now.startsWith("says: ")) now = oneLine(`says: ${said}`);
        }
        break;
    }
  }
  return { task, now };
}

/**
 * What the agent last announced about itself: its plan, context and cost
 * use, slash commands, settings, and who it is signed in as. The last
 * event of each kind wins; channels keep each agent's own (by author).
 */
function liveState(events: StoredChatEvent[], who?: Author) {
  const same = (from?: Author) => (!who && !from) || (who?.kind === "agent" && from?.kind === "agent" && from.slug === who.slug);
  let plan: PlanEntry[] | null = null;
  let usage: { used: number; size: number; costUsd?: number } | undefined;
  let commands: AgentCommand[] = [];
  let config: ConfigOption[] = [];
  let auth: AuthStatus | undefined;
  for (const e of events) {
    if (!same(e.from)) continue;
    if (e.type === "plan") plan = e.entries;
    else if (e.type === "usage") usage = { used: e.used, size: e.size, costUsd: e.costUsd };
    else if (e.type === "commands") commands = e.commands;
    else if (e.type === "config") config = e.options;
    else if (e.type === "auth") auth = e;
  }
  return { plan, usage, commands, config, auth };
}

/* ---------- thread ---------- */

export function ChatThread({
  id,
  agentName,
  agentDescription,
  channel,
  agents,
}: {
  id: string;
  agentName?: string;
  agentDescription?: string;
  /** Channel mode: several agents, signed messages, @mentions. */
  channel?: Channel;
  agents?: Agent[];
}) {
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [events, setEvents] = useState<StoredChatEvent[]>([]);
  const [gone, setGone] = useState(false);
  const [picker, setPicker] = useState(false);
  const [coworker, setCoworker] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkNote, setForkNote] = useState<string | null>(null);
  // Channels: look at one agent's own session (its stream alone, tools included).
  const [focus, setFocus] = useState<string | null>(null);
  const features = useFeatures();
  const live = useMemo(() => liveState(events), [events]);

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    fetch(`/api/chats/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { meta: ChatMeta; events: StoredChatEvent[] }) => {
        if (!alive) return;
        setMeta(d.meta);
        setEvents(d.events);
        const last = d.events[d.events.length - 1]?.seq ?? 0;
        es = new EventSource(`/api/chats/${id}/events?after=${last}`);
        es.onmessage = (m) => {
          const ev: StoredChatEvent = JSON.parse(m.data);
          setEvents((prev) =>
            prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev]
          );
        };
      })
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
      es?.close();
    };
  }, [id]);

  // Channels: agents run in parallel, each turn_start pairs with a turn_end
  // (or error) by the same agent. Ordinary chats: one turn at a time.
  const working = useMemo(() => {
    if (!channel) return [] as string[];
    const open = new Set<string>();
    for (const e of events) {
      if (e.from?.kind !== "agent") continue;
      if (e.type === "turn_start") open.add(e.from.slug);
      if (e.type === "turn_end" || e.type === "error") open.delete(e.from.slug);
    }
    return [...open];
  }, [events, channel]);
  const busy = useMemo(() => {
    if (channel) return working.length > 0;
    for (let i = events.length - 1; i >= 0; i--) {
      const t = events[i].type;
      if (t === "user_message") return true;
      if (t === "turn_end" || t === "error") return false;
    }
    return false;
  }, [events, channel, working]);

  // Session title: server names the chat after the first message, but the
  // meta we hold was fetched before that — fall back to the first user
  // message so the heading + tab update live.
  const title = useMemo(() => {
    if (meta?.title) return meta.title;
    const first = events.find((e) => e.type === "user_message");
    return first && first.type === "user_message"
      ? first.text.replace(/\s+/g, " ").trim().slice(0, 80)
      : "";
  }, [meta, events]);

  // Browser tab: "<agent> · <agent description> · <session> — <project>".
  useEffect(() => {
    if (!meta) return;
    if (channel) {
      setPageTitle(`#${channel.slug} · ${channel.name}`);
      return () => setPageTitle("");
    }
    const who = agentName ?? (meta.scope.kind === "agent" ? meta.scope.slug : meta.agent);
    setPageTitle([who, agentDescription, title || "new chat"].filter(Boolean).join(" · "));
    return () => setPageTitle("");
  }, [meta, title, agentName, agentDescription, channel]);

  if (gone) return <div className="empty">chat not found</div>;
  if (!meta) return <div className="empty">loading…</div>;

  const agentMap = new Map((agents ?? []).map((a) => [a.slug, a]));

  if (channel) {
    return (
      <div className="chat-split">
        <div className="chat-thread channel-thread">
          <div className="detail-head channel-head">
            <span className={`lamp ${busy ? "running" : "ok"}`} />
            <h1>#{channel.slug}</h1>
            <span className="channel-name">{channel.name}</span>
            <span className="spacer" />
            {working.length > 0 && (
              <button className="stop-btn" title="interrupt every agent working in this channel" onClick={() => stopAgent(id)}>
                <Icon name="stop" className="ms-sm" /> stop all ({working.length})
              </button>
            )}
            <Link href={`/channels/${encodeURIComponent(channel.slug)}/edit`} className="open-raw" title="members, purpose, responder">
              <Icon name="tune" className="ms-sm" /> members
            </Link>
          </div>
          <div className="channel-members">
            {channel.purpose && <span className="channel-purpose">{channel.purpose}</span>}
            {channel.members.map((m) => {
              const a = agentMap.get(m);
              const on = working.includes(m);
              const act = agentActivity(events, m);
              return (
                <div key={m} className={`member-chip ${on ? "working" : ""} ${focus === m ? "focused" : ""}`} title={a?.description}>
                  <button className="member-open" onClick={() => setFocus(focus === m ? null : m)} title={focus === m ? "back to the channel" : `look at @${m}'s session`}>
                    <span className="agent-avatar sm">
                      <span aria-hidden>{a?.emoji ?? "🤖"}</span>
                      <span className={`lamp ${on ? "running" : "idle"}`} />
                    </span>
                    <span className="member-text">
                      <span className="member-line">
                        <span className="member-name">{a?.name ?? m}</span>
                        <span className="member-handle">@{m}</span>
                        {channel.responder === m && <span className="chip">responder</span>}
                      </span>
                      {(act.task || act.now) && (
                        <span className="member-activity">
                          {on ? (act.now ? <><span className="microlabel">now</span> {act.now}</> : <>working on: {act.task}</>) : <><span className="microlabel">last</span> {act.task}</>}
                        </span>
                      )}
                    </span>
                  </button>
                  {on && (
                    <button className="member-stop" title={`interrupt @${m}`} onClick={() => stopAgent(id, m)}>
                      <Icon name="stop" className="ms-sm" />
                    </button>
                  )}
                  <Link href={`/agents/${encodeURIComponent(m)}/info`} className="member-info" title="agent definition">
                    <Icon name="info" className="ms-sm" />
                  </Link>
                </div>
              );
            })}
          </div>
          {focus && (
            <div className="focus-bar">
              <button className="ws-btn" onClick={() => setFocus(null)}>
                <Icon name="arrow_back" className="ms-sm" /> channel
              </button>
              <span className="focus-title">
                {agentMap.get(focus)?.emoji ?? "🤖"} @{focus}'s session — everything this agent did, tools included
              </span>
              <span className="spacer" />
              {working.includes(focus) && (
                <button className="stop-btn" onClick={() => stopAgent(id, focus)}>
                  <Icon name="stop" className="ms-sm" /> stop @{focus}
                </button>
              )}
            </div>
          )}
          <Thread id={id} events={events} busy={busy} channel={channel} agentMap={agentMap} working={working} focus={focus ?? undefined} />
          <Composer id={id} busy={busy} scope={meta.scope} channel={channel} agentMap={agentMap} />
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-split${meta.vibeable ? " open" : ""}`}>
    <div className="chat-thread">
      <div className="detail-head">
        <span className={`lamp ${busy ? "running" : "ok"}`} />
        <h1>{title || "new chat"}</h1>
        {meta.scope.kind === "agent" && !meta.scope.routine && (
          <button className="ws-btn coworker-btn" onClick={() => setCoworker(true)} title="Turn this session into a channel and invite more agents" disabled={busy}>
            <Icon name="group_add" className="ms-sm" /> add coworker
          </button>
        )}
        {meta.agent !== "pi" && meta.sessions?.main && (
          <button
            className={`ws-btn fork-btn${meta.agent === "codex" ? " muted" : ""}`}
            disabled={busy || forking}
            aria-disabled={meta.agent === "codex"}
            title={meta.agent === "codex" ? "not supported: codex has no session fork" : "Branch this conversation: a new chat with the same history, the original stays as it is"}
            onClick={async () => {
              if (meta.agent === "codex") return setForkNote("fork is not supported by codex");
              setForking(true);
              const r = await fetch(`/api/chats/${id}/fork`, { method: "POST" });
              const body = (await r.json().catch(() => ({}))) as ChatMeta & { error?: string };
              setForking(false);
              if (!r.ok || !body.id) return alert(body.error ?? `fork failed (${r.status})`);
              navigate(body.scope?.kind === "agent" ? `/agents/${encodeURIComponent(body.scope.slug)}/chat/${body.id}` : `/agents/chats/${body.id}`);
            }}
          >
            <Icon name="call_split" className="ms-sm" /> {forking ? "forking…" : "fork"}
          </button>
        )}
        {forkNote && <span className="fork-note">{forkNote}</span>}
        {!meta.vibeable && features.vibeables && (
          <button className="ws-btn vibeable-open" onClick={() => setPicker(true)} title="Build a small app live: a preview pane next to this chat" disabled={busy}>
            <Icon name="web" className="ms-sm" /> vibeable
          </button>
        )}
        <span className="chip agent">{meta.agent}</span>
        <AgentStatus id={id} live={live} />
        {meta.scope.kind === "run" && (
          <Link href={`/runs/${meta.scope.runId}`} className="chip">
            {meta.scope.runId}
          </Link>
        )}
        {meta.scope.kind === "kraftwerk" && <span className="chip">kraftwerk-aware</span>}
        {meta.scope.kind === "knowledge" && (
          <Link
            href={meta.scope.bundle ? `/knowledge/${encodeURIComponent(meta.scope.bundle)}` : "/knowledge"}
            className="chip"
          >
            knowledge{meta.scope.bundle ? `:${meta.scope.bundle}` : ""}
          </Link>
        )}
        {meta.scope.kind === "agent" && (
          <Link href={`/agents/${encodeURIComponent(meta.scope.slug)}/info`} className="chip">
            agent:{meta.scope.slug}
          </Link>
        )}
        <span className="rid" title={meta.cwd}>
          {meta.cwd}
        </span>
      </div>
      <Thread id={id} events={events} busy={busy} />
      <Composer id={id} busy={busy} scope={meta.scope} commands={live.commands} canSteer={meta.agent !== "pi"} />
    </div>
    {meta.vibeable && features.vibeables && <VibePane key={meta.vibeable} chatId={id} slug={meta.vibeable} agentBusy={busy} onClosed={setMeta} />}
    {meta.vibeable && !features.vibeables && <VibeOffNote chatId={id} slug={meta.vibeable} onClosed={setMeta} />}
    {picker && (
      <VibePicker
        chatId={id}
        onClose={() => setPicker(false)}
        onOpened={(m) => {
          setMeta(m);
          setPicker(false);
        }}
      />
    )}
    {coworker && meta.scope.kind === "agent" && (
      <AddCoworkerDialog chatId={id} agentSlug={meta.scope.slug} title={title} onClose={() => setCoworker(false)} />
    )}
    </div>
  );
}

/** Rendered thread block. */
type Block =
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

const sameAuthor = (a?: Author, b?: Author): boolean =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && (a.kind === "human" ? a.name === (b as { name: string }).name : a.slug === (b as { slug: string }).slug));

function toBlocks(events: StoredChatEvent[]): Block[] {
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

const ACTIVITY_KINDS = new Set(["tool", "thought", "subagent", "task", "files"]);

function Thread({
  id,
  events,
  busy,
  channel,
  agentMap,
  working,
  focus,
}: {
  id: string;
  events: StoredChatEvent[];
  busy: boolean;
  channel?: Channel;
  agentMap?: Map<string, Agent>;
  working?: string[];
  /** Channels: show one agent's session — its events and the humans' messages, activity always on. */
  focus?: string;
}) {
  const expert = useExpertMode();
  const blocks = useMemo(() => {
    const shown = focus
      ? events.filter((e) => e.from?.kind === "human" || (e.from?.kind === "agent" && e.from.slug === focus))
      : events;
    const all = toBlocks(shown);
    // Simple mode: no tool activity, no thinking — the conversation plus
    // the "working…" indicator below is the whole story. Looking at one
    // agent's session is the opposite: the activity is the point.
    return expert || focus ? all : all.filter((b) => !ACTIVITY_KINDS.has(b.kind));
  }, [events, expert, focus]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [blocks, busy]);

  return (
    <div
      className="chat-scroll"
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {blocks.length === 0 && (
        <div className="empty">
          {channel
            ? `say something — @mention an agent to wake it${channel.responder ? `, or just write: @${channel.responder} answers` : ""}`
            : "say something — the agent starts on your first message"}
        </div>
      )}
      {blocks.map((b, i) => {
        // Channels: a byline whenever the author changes.
        const prev = blocks[i - 1];
        const byline = channel && b.kind !== "error" && (!prev || !sameAuthor(prev.from, b.from) || prev.kind === "error") ? b.from : undefined;
        return (
          <div key={b.key} className={`turn ${b.from?.kind === "human" ? "human" : b.from?.kind === "agent" ? "agent" : ""}`}>
            {byline && <Byline from={byline} agentMap={agentMap} />}
            <BlockView b={b} chatId={id} />
          </div>
        );
      })}
      {busy && (
        <div className="chat-working">
          <span className="lamp running" />{" "}
          {channel && working?.length
            ? working.map((w) => `${agentMap?.get(w)?.emoji ?? ""} @${w}`).join(", ") + (working.length === 1 ? " is working…" : " are working…")
            : "working…"}
        </div>
      )}
    </div>
  );
}

/** Channel byline: who says the next message(s). */
function Byline({ from, agentMap }: { from: Author; agentMap?: Map<string, Agent> }) {
  if (from.kind === "human") {
    return (
      <div className="byline human">
        <span className="byline-avatar">{from.name.slice(0, 1).toUpperCase()}</span>
        <span className="byline-name">{from.name}</span>
      </div>
    );
  }
  const a = agentMap?.get(from.slug);
  return (
    <Link href={`/agents/${encodeURIComponent(from.slug)}/info`} className="byline agent">
      <span className="byline-avatar">{a?.emoji ?? "🤖"}</span>
      <span className="byline-name">{a?.name ?? from.slug}</span>
      <span className="byline-handle">@{from.slug}</span>
    </Link>
  );
}

/** Agent replies are markdown — render them (sanitized; images/links included). */
function AgentMessage({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false })), [text]);
  return <div className="msg agent md-body chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function BlockView({ b, chatId }: { b: Block; chatId: string }) {
  switch (b.kind) {
    case "user":
      return (
        <div className={`msg user${b.steered ? " steered" : ""}`}>
          {b.steered && <span className="microlabel steer-label">steered in</span>}
          {b.text}
          {b.attachments && b.attachments.length > 0 && (
            <div className="attachments">
              {b.attachments.map((a) => {
                const href = `/api/chats/${chatId}/attachments/${encodeURIComponent(a.name)}`;
                return a.mimeType.startsWith("image/") ? (
                  <a key={a.name} href={href} target="_blank" rel="noreferrer" title={a.name}>
                    <img src={href} alt={a.name} />
                  </a>
                ) : (
                  <a key={a.name} className="file-link" href={href} target="_blank" rel="noreferrer">
                    <Icon name="attach_file" className="ms-sm" /> {a.name}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      );
    case "agent":
      return <AgentMessage text={b.text} />;
    case "thought":
      return (
        <details className="msg thought">
          <summary>thinking</summary>
          <div>{b.text}</div>
        </details>
      );
    case "tool":
      return (
        <div className={`tool-card ${b.status ?? ""}${b.compaction ? " compaction" : ""}`}>
          <span
            className={`lamp ${
              b.status === "completed" ? "ok" : b.status === "failed" ? "failed" : "running"
            }`}
          />
          <span className="chip tool-kind">{b.compaction ? "compact" : b.toolKind}</span>
          <span className="tool-title">
            {b.compaction ? compactionLabel(b.compaction, b.status) : b.title}
          </span>
        </div>
      );
    case "subagent":
      return (
        <details className={`subagent-card ${b.state ?? "running"}`} open={!b.state}>
          <summary>
            <span className={`lamp ${b.state === "completed" ? "ok" : b.state === "failed" ? "failed" : b.state ? "idle" : "running"}`} />
            <span className="chip tool-kind">subagent</span>
            <span className="tool-title">
              <b>{b.name}</b> — {b.task}
              {b.state && b.state !== "completed" && <span className="subagent-state"> · {b.state}</span>}
            </span>
          </summary>
          <div className="subagent-body">
            {b.children.length === 0 && <div className="subagent-empty">working…</div>}
            {b.children.map((c) => (
              <BlockView key={c.key} b={c} chatId={chatId} />
            ))}
          </div>
        </details>
      );
    case "task":
      return (
        <div className={`tool-card task-card ${b.state ?? ""}`}>
          <span className={`lamp ${b.state === "completed" ? "ok" : b.state === "failed" ? "failed" : b.state === "running" ? "running" : "idle"}`} />
          <span className="chip tool-kind">{b.taskType}</span>
          <span className="tool-title">
            <b>{b.name}</b> — {b.summary ?? b.description}
            {b.state && b.state !== "running" && b.state !== "completed" && <span className="subagent-state"> · {b.state}</span>}
          </span>
          {b.canStop && (b.state === "running" || b.state === "paused") && (
            <button
              className="task-stop"
              title="stop this background task (the turn goes on)"
              onClick={() =>
                fetch(`/api/chats/${chatId}/task-stop`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ taskId: b.taskId }),
                }).catch(() => {})
              }
            >
              <Icon name="stop" className="ms-sm" /> stop
            </button>
          )}
        </div>
      );
    case "plan":
      return (
        <div className={`plan-card${b.removed ? " removed" : ""}`}>
          <div className="plan-head">
            <span className="microlabel">plan</span>
            <span className="plan-count">
              {b.entries.filter((e) => e.status === "completed").length}/{b.entries.length}
            </span>
          </div>
          <ul>
            {b.entries.map((e, i) => (
              <li key={i} className={`plan-${e.status} prio-${e.priority}`}>
                <Icon name={e.status === "completed" ? "check_circle" : e.status === "in_progress" ? "play_circle" : "radio_button_unchecked"} className="ms-sm" />
                <span>{e.content}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "files":
      return (
        <div className="tool-card files-card">
          <span className="lamp ok" />
          <span className="chip tool-kind">changed</span>
          <span className="tool-title">
            {b.paths.join("\n")}
            {(!b.complete || b.note) && <span className="subagent-state"> · {b.note ?? "list may be incomplete"}</span>}
          </span>
        </div>
      );
    case "question":
      return <QuestionCard b={b} chatId={chatId} />;
    case "permission":
      return <PermissionCard b={b} chatId={chatId} />;
    case "error":
      return <div className="msg error"><Icon name="error" className="ms-sm" /> {b.text}</div>;
    case "failure":
      return <FailureCard b={b} chatId={chatId} />;
  }
}

const FAILURE_ACTION_LABEL: Record<SessionFailure["actions"][number], string> = {
  retry: "try again",
  login: "sign in again",
  new_session: "start a fresh session",
};

/**
 * What the harness reported about its session (a rate limit, an expired
 * login, a provider outage) with the action it recommends. Live until the
 * next turn ends; then it stays as history, without buttons.
 */
function FailureCard({ b, chatId }: { b: Extract<Block, { kind: "failure" }>; chatId: string }) {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const f = b.failure;
  const live = !b.resolved && !note;

  async function act(action: SessionFailure["actions"][number]) {
    if (action === "login") {
      setNote("Sign in again in a terminal (claude login, or codex login), then send your message again.");
      return;
    }
    setSending(true);
    try {
      if (action === "retry") {
        if (!b.retryText) return setNote("nothing to retry — send a message");
        await fetch(`/api/chats/${chatId}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: b.retryText }),
        });
      } else {
        const r = await fetch(`/api/chats/${chatId}/reset-session`, { method: "POST" });
        if (!r.ok) setNote(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `reset failed (${r.status})`);
      }
    } catch {
      /* offline: the buttons stay */
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`failure-card ${f.severity} ${live ? "live" : "settled"}`}>
      <div className="failure-title">
        <Icon name={f.severity === "warning" ? "warning" : "error"} className="ms-sm" />
        <span className="microlabel">{f.category}</span> {f.title}
      </div>
      {f.details && <div className="failure-details">{f.details}</div>}
      {note && <div className="failure-details">{note}</div>}
      {live && f.actions.length > 0 && (
        <div className="failure-actions">
          {f.actions.map((a) => (
            <button key={a} className="ws-btn" disabled={sending} onClick={() => act(a)}>
              {FAILURE_ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Compact conversation · 142k → 31k tokens · automatic" */
function compactionLabel(c: Compaction, status?: string): string {
  const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));
  const parts = [status === "completed" ? "context compacted" : status === "failed" ? "compaction failed" : "compacting context"];
  if (c.preTokens != null && c.postTokens != null) parts.push(`${k(c.preTokens)} → ${k(c.postTokens)} tokens`);
  else if (c.preTokens != null) parts.push(`${k(c.preTokens)} tokens`);
  if (c.trigger) parts.push(c.trigger);
  if (c.error) parts.push(c.error);
  return parts.join(" · ");
}

/** Header chips: signed-in identity, context window and cost, and the settings the agent lets us change. */
function AgentStatus({ id, live }: { id: string; live: ReturnType<typeof liveState> }) {
  const expert = useExpertMode();
  const [busyId, setBusyId] = useState<string | null>(null);
  const shown = live.config.filter((o) => o.category === "model" || o.category === "thought_level");
  async function change(o: ConfigOption, value: string | boolean) {
    setBusyId(o.id);
    const r = await fetch(`/api/chats/${id}/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configId: o.id, value }),
    }).catch(() => null);
    setBusyId(null);
    if (r && !r.ok) alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `setting refused (${r.status})`);
  }
  return (
    <>
      {live.auth && (
        <span className={`chip auth ${live.auth.kind}`} title={[live.auth.detail, live.auth.email, live.auth.organization, live.auth.plan].filter(Boolean).join(" · ")}>
          <Icon name={live.auth.kind === "none" ? "person_off" : "person"} className="ms-sm" /> {live.auth.email ?? live.auth.label}
        </span>
      )}
      {expert && live.usage && live.usage.size > 0 && (
        <span className="chip usage" title={`${live.usage.used.toLocaleString()} of ${live.usage.size.toLocaleString()} context tokens${live.usage.costUsd != null ? ` · $${live.usage.costUsd.toFixed(2)} so far` : ""}`}>
          {Math.round((100 * live.usage.used) / live.usage.size)}% ctx
          {live.usage.costUsd != null && ` · $${live.usage.costUsd.toFixed(2)}`}
        </span>
      )}
      {expert &&
        shown.map((o) =>
          o.type === "select" ? (
            <select
              key={o.id}
              className="config-select"
              value={o.value}
              disabled={busyId === o.id}
              title={o.description ?? o.name}
              onChange={(e) => change(o, e.target.value)}
            >
              {o.choices.map((c) => (
                <option key={c.value} value={c.value} title={c.description}>
                  {c.group ? `${c.group} · ` : ""}{c.name}
                </option>
              ))}
            </select>
          ) : (
            <label key={o.id} className="chip config-bool" title={o.description ?? o.name}>
              <input type="checkbox" checked={o.value} disabled={busyId === o.id} onChange={(e) => change(o, e.target.checked)} /> {o.name}
            </label>
          )
        )}
    </>
  );
}

/** The agent asked something: a small form built from the elicitation's fields. */
function QuestionCard({ b, chatId }: { b: Extract<Block, { kind: "question" }>; chatId: string }) {
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>({});
  const [sending, setSending] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const pending = b.resolved === undefined && !gone;

  async function answer(action: "accept" | "decline") {
    setSending(true);
    try {
      const r = await fetch(`/api/chats/${chatId}/elicitation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: b.requestId, action, ...(action === "accept" ? { content: values } : {}) }),
      });
      if (!r.ok) setGone(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `request failed (${r.status})`);
    } catch {
      /* offline: the form stays */
    }
    setSending(false);
  }
  const set = (key: string, v: string | number | boolean | string[]) => setValues((prev) => ({ ...prev, [key]: v }));
  const missing = b.fields.some((f) => f.required && (values[f.key] === undefined || values[f.key] === ""));

  return (
    <div className={`perm-card question-card ${pending ? "pending" : ""}`}>
      <div className="perm-title">
        <span className="microlabel">question</span> {b.message}
      </div>
      {pending ? (
        <div className="question-fields">
          {b.fields.map((f) => (
            <label key={f.key} className={`question-field ${f.kind}${f.custom ? " custom" : ""}`}>
              {(f.title || f.description) && !f.custom && (
                <span className="question-label">
                  {f.title && <b>{f.title}</b>}
                  {f.description && <span> {f.description}</span>}
                </span>
              )}
              {f.kind === "select" && (
                <div className="question-options">
                  {f.options?.map((o) => (
                    <button
                      key={o.value}
                      className={`perm-btn ${values[f.key] === o.value ? "allow" : ""}`}
                      title={o.description}
                      onClick={() => set(f.key, o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {f.kind === "multiselect" && (
                <div className="question-options">
                  {f.options?.map((o) => {
                    const cur = (values[f.key] as string[] | undefined) ?? [];
                    const on = cur.includes(o.value);
                    return (
                      <button key={o.value} className={`perm-btn ${on ? "allow" : ""}`} title={o.description} onClick={() => set(f.key, on ? cur.filter((v) => v !== o.value) : [...cur, o.value])}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {f.kind === "text" && (
                <input
                  type="text"
                  placeholder={f.custom ? "or type your own answer" : (f.title ?? f.key)}
                  value={(values[f.key] as string | undefined) ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.kind === "number" && (
                <input type="number" value={(values[f.key] as number | undefined) ?? ""} onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))} />
              )}
              {f.kind === "boolean" && (
                <span>
                  <input type="checkbox" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> {f.title ?? f.key}
                </span>
              )}
            </label>
          ))}
          <div className="perm-actions">
            <button className="perm-btn allow" disabled={sending || missing} onClick={() => answer("accept")}>
              answer
            </button>
            <button className="perm-btn deny" disabled={sending} onClick={() => answer("decline")}>
              skip
            </button>
          </div>
        </div>
      ) : (
        <div className="perm-resolved">
          {gone
            ? `→ ${gone}`
            : b.resolved?.action === "accept"
              ? `→ ${Object.values(b.resolved.content ?? {})
                  .filter((v) => v !== "" && v !== undefined && !(Array.isArray(v) && v.length === 0))
                  .map((v) => (Array.isArray(v) ? v.join(", ") : String(v)))
                  .join(" · ") || "answered"}`
              : b.resolved?.action === "decline"
                ? "→ skipped"
                : "→ dismissed"}
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  b,
  chatId,
}: {
  b: Extract<Block, { kind: "permission" }>;
  chatId: string;
}) {
  const [sending, setSending] = useState(false);
  // The server no longer holds this request (answered elsewhere, or the
  // agent is gone): say so instead of leaving buttons that do nothing.
  const [gone, setGone] = useState<string | null>(null);
  const pending = b.resolved === undefined && !gone;

  async function answer(optionId: string | null) {
    setSending(true);
    try {
      const r = await fetch(`/api/chats/${chatId}/permission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: b.requestId, optionId }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setGone(body.error ?? `request failed (${r.status})`);
      }
    } catch {
      /* offline: the buttons stay, the next click retries */
    }
    setSending(false);
  }

  return (
    <div className={`perm-card ${pending ? "pending" : ""}`}>
      <div className="perm-title">
        <span className="microlabel">permission</span> {b.title}
      </div>
      {pending ? (
        <div className="perm-actions">
          {b.options.map((o) => (
            <button
              key={o.optionId}
              className={`perm-btn ${o.kind?.startsWith("allow") ? "allow" : "deny"}`}
              disabled={sending}
              onClick={() => answer(o.optionId)}
            >
              {o.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="perm-resolved">
          {b.resolved
            ? `→ ${b.options.find((o) => o.optionId === b.resolved)?.name ?? b.resolved}`
            : gone
              ? `→ ${gone}`
              : "→ dismissed"}
        </div>
      )}
    </div>
  );
}

function Composer({
  id,
  busy,
  scope,
  channel,
  agentMap,
  commands = [],
  canSteer,
}: {
  id: string;
  busy: boolean;
  scope?: ChatScope;
  channel?: Channel;
  agentMap?: Map<string, Agent>;
  /** The agent's own slash commands, offered next to the skills. */
  commands?: AgentCommand[];
  /** A running turn can take a message (steering) instead of blocking the composer. */
  canSteer?: boolean;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Files dropped or pasted into the composer: uploaded right away (so a
  // screenshot shows while you type), sent with the next message.
  const [files, setFiles] = useState<Array<Attachment & { preview?: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const r = await fetch(`/api/chats/${id}/attachments`, {
          method: "POST",
          headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name || "pasted.png") },
          body: f,
        });
        const body = (await r.json()) as Attachment & { error?: string };
        if (!r.ok) setProblem(body.error ?? `upload failed (${r.status})`);
        else setFiles((prev) => [...prev, { ...body, ...(f.type.startsWith("image/") ? { preview: URL.createObjectURL(f) } : {}) }]);
      } catch {
        setProblem("upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [me, setMe] = useState(myName);
  const [editingMe, setEditingMe] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Channels never block the humans: an agent that is busy is woken again
  // when its turn ends. Ordinary chats take one message per turn — unless
  // the agent takes steering, then a message goes into the running turn.
  const steering = busy && !channel && !!canSteer;
  const locked = busy && !channel && !canSteer;

  // Skills the /-menu offers: all discovered ones, narrowed by the agent
  // member's allowlist when this is a agent session, plus the member's own
  // agent skills, which always apply and shadow shared ones (mirrors the server).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetch("/api/skills").then((r) => r.json());
        let list: SkillInfo[] = d.skills ?? [];
        if (scope?.kind === "agent") {
          const [m, own] = await Promise.all([
            fetch(`/api/agents/${encodeURIComponent(scope.slug)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
            fetch(`/api/agents/${encodeURIComponent(scope.slug)}/skills`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ]);
          if (m && Array.isArray(m.skills)) {
            const allowed = new Set(m.skills.map((n: string) => n.toLowerCase()));
            list = list.filter((s) => allowed.has(s.name.toLowerCase()));
          }
          const agentSkills: SkillInfo[] = own?.skills ?? [];
          const shadowed = new Set(agentSkills.map((s) => s.name.toLowerCase()));
          list = [...agentSkills, ...list.filter((s) => !shadowed.has(s.name.toLowerCase()))];
        }
        if (alive) setSkills(list);
      } catch {
        /* skills menu is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // The menu is open while the draft is just "/<partial-name>".
  const slashQuery = /^\/([\w-]*)$/.exec(text)?.[1];
  const skillMatches =
    slashQuery !== undefined && !dismissed
      ? skills.filter((s) => s.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
      : [];
  const skillNames = new Set(skills.map((s) => s.name.toLowerCase()));
  const commandMatches =
    slashQuery !== undefined && !dismissed
      ? commands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase()) && !skillNames.has(c.name.toLowerCase()))
      : [];
  // Channels: "@partial" at the caret offers the members.
  const caret = taRef.current?.selectionStart ?? text.length;
  const atMatch = channel && !dismissed ? /(^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret)) : null;
  const mentionMatches =
    atMatch && channel
      ? channel.members.filter((m) => m.startsWith(atMatch[2].toLowerCase()) || (agentMap?.get(m)?.name ?? "").toLowerCase().startsWith(atMatch[2].toLowerCase()))
      : [];
  const allMatches: Array<{ id: string; label: string; hint?: string; src?: string; pick: () => void }> = [
    ...skillMatches.map((s) => ({
      id: `/${s.name}`,
      label: `/${s.name}`,
      hint: s.description,
      src: s.source,
      pick: () => {
        setText(`/${s.name} `);
        setSel(0);
      },
    })),
    ...commandMatches.map((c) => ({
      id: `/${c.name}`,
      label: `/${c.name}${c.hint ? ` ${c.hint}` : ""}`,
      hint: c.description,
      src: "agent",
      pick: () => {
        setText(`/${c.name} `);
        setSel(0);
      },
    })),
    ...mentionMatches.map((m) => ({
      id: `@${m}`,
      label: `${agentMap?.get(m)?.emoji ?? "🤖"} @${m}`,
      hint: agentMap?.get(m)?.name,
      pick: () => {
        const before = text.slice(0, caret).replace(/@[a-z0-9-]*$/i, `@${m} `);
        setText(before + text.slice(caret));
        setSel(0);
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (el) el.selectionStart = el.selectionEnd = before.length;
        });
      },
    })),
  ];
  // Skills first, then the agent's own commands (there can be well over a hundred): keep the menu short.
  const matches = allMatches.slice(0, 15);
  const menuOpen = matches.length > 0;
  const selIdx = Math.min(sel, matches.length - 1);

  async function send() {
    const t = text.trim();
    if ((!t && files.length === 0) || locked || uploading > 0) return;
    const attachments = files.map(({ preview: _p, ...a }) => a);
    setText("");
    setFiles([]);
    setProblem(null);
    const r = await fetch(`/api/chats/${id}/${steering ? "steer" : "message"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t, ...(attachments.length ? { attachments } : {}), ...(channel ? { from: me || "you" } : {}) }),
    }).catch(() => null);
    if (r && !r.ok) {
      setProblem(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `not sent (${r.status})`);
      setText(t);
      setFiles(files);
    }
  }

  return (
    <div
      className={`composer${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <div className="composer-files">
          {files.map((f) => (
            <span key={f.name} className="file-chip" title={`${f.name} · ${Math.round(f.size / 1024)} KB`}>
              {f.preview ? <img src={f.preview} alt={f.name} /> : <Icon name="attach_file" className="ms-sm" />}
              {f.name.replace(/^\d{8}-\d{6}-/, "")}
              <button title="remove" onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}>
                <Icon name="close" className="ms-sm" />
              </button>
            </span>
          ))}
          {uploading > 0 && <span className="file-chip">uploading…</span>}
        </div>
      )}
      {channel && (
        <div className="composer-me">
          posting as{" "}
          {editingMe ? (
            <input
              autoFocus
              value={me}
              placeholder="your name"
              onChange={(e) => setMe(e.target.value)}
              onBlur={() => {
                setMyName(me.trim());
                setEditingMe(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <button className="me-name" onClick={() => setEditingMe(true)} title="change your name">
              {me || "you"} <Icon name="edit" className="ms-sm" />
            </button>
          )}
        </div>
      )}
      {menuOpen && (
        <div className="skill-menu">
          {matches.map((s, i) => (
            <button
              key={s.id}
              className={i === selIdx ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                s.pick();
              }}
            >
              <b>{s.label}</b>
              {s.hint && <span> — {s.hint}</span>}
              {s.src && <span className="skill-src">{s.src}</span>}
            </button>
          ))}
        </div>
      )}
      {problem && <div className="composer-problem">{problem}</div>}
      <textarea
        ref={taRef}
        value={text}
        placeholder={
          locked
            ? "agent is working…"
            : steering
              ? "agent is working — a message now steers it mid-turn"
              : channel
              ? "message the channel  ·  @ to mention an agent, / for skills, Enter to send"
              : "message  ·  Enter to send, Shift+Enter for newline, / for skills, drop or paste files"
        }
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        onChange={(e) => {
          setText(e.target.value);
          setSel(0);
          setDismissed(false);
        }}
        onPaste={(e) => {
          // A screenshot from the clipboard arrives as a file item.
          const pasted = Array.from(e.clipboardData.items)
            .filter((it) => it.kind === "file")
            .map((it) => it.getAsFile())
            .filter((f): f is File => !!f);
          if (pasted.length) {
            e.preventDefault();
            void addFiles(pasted);
          }
        }}
        onKeyDown={(e) => {
          if (menuOpen) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              return setSel((selIdx + 1) % matches.length);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              return setSel((selIdx - 1 + matches.length) % matches.length);
            }
            if (e.key === "Tab" || e.key === "Enter") {
              e.preventDefault();
              return matches[selIdx].pick();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              return setDismissed(true);
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {busy && (
        <button
          className="stop-btn"
          onClick={() => fetch(`/api/chats/${id}/cancel`, { method: "POST" }).catch(() => {})}
        >
          <Icon name="stop" className="ms-sm" /> stop
        </button>
      )}
      {!locked && (
        <button className="ws-btn attach-btn" title="attach files (or drop / paste them)" onClick={() => fileRef.current?.click()}>
          <Icon name="attach_file" className="ms-sm" />
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {!locked && (
        <button className="run-btn" disabled={(!text.trim() && files.length === 0) || uploading > 0} onClick={send} title={steering ? "hand this into the running turn" : undefined}>
          <Icon name={steering ? "alt_route" : "send"} className="ms-sm" /> {steering ? "steer" : "send"}
        </button>
      )}
    </div>
  );
}
