import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { onBrowseClick, withBrowseIcons } from "./context-browser";
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
import { Icon, Link, navigate, setPageTitle, useExpertMode, useFeatures, usePoll } from "./shared";
import { VIBE_SLOT_ID, VibeOffNote, VibePane, announceVibeable } from "./vibeables";
import { AddCoworkerDialog } from "./channels";
import { Button, cn, Dot, EmptyState, Eyebrow, IconButton, ListRow, Notice, Page, Panel, Select, Tag, TextField, Title, type DotTone } from "./ui";

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
 * "Ralv" entry; history comes from GET /api/chats/:id, live
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
        : meta.scope?.kind === "project"
          ? `/projects/${encodeURIComponent(meta.scope.slug)}/chat/${meta.id}`
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
    <Page width="narrow">
      <Title>new chat</Title>
      <Panel title="agent">
        <div className="grid grid-cols-3 gap-2.5 p-4 max-[940px]:grid-cols-1">
          {AGENTS.map((a) => {
            const on = agent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-card border px-3.5 py-3 text-left transition-colors",
                  on ? "border-transparent bg-accent-soft text-on-accent-soft" : "border-line bg-transparent text-fg hover:bg-surface-2"
                )}
                onClick={() => setAgent(a.id)}
              >
                <b className="text-base font-medium">{a.label}</b>
                <span className={cn("text-xs", on ? "text-on-accent-soft" : "text-fg-2")}>{a.hint}</span>
              </button>
            );
          })}
        </div>
        <label className="flex cursor-pointer items-center gap-2 px-4 pb-3.5 text-sm text-fg-2">
          <input type="checkbox" className="size-[15px] accent-accent" checked={kraftwerkAware} onChange={(e) => setKraftwerkAware(e.target.checked)} />
          <span className="text-fg">kraftwerk-aware</span> — agent gets workflows + recent runs as context
        </label>
        <div className="px-4 pb-4">
          <Button
            variant="primary"
            busy={creating}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen(agent, { kind: kraftwerkAware ? "kraftwerk" : "general" });
              setCreating(false);
            }}
          >
            {creating ? "starting…" : "start chat"}
          </Button>
        </div>
      </Panel>
      {agent !== "pi" && (
        <Panel
          title="continue a session"
          actions={
            sessions === null && (
              <Button
                size="sm"
                variant="quiet"
                icon="history"
                onClick={async () => {
                  setSessions("loading");
                  const d = await fetch(`/api/agent-sessions?agent=${agent}`)
                    .then((r) => (r.ok ? r.json() : { sessions: [] }))
                    .catch(() => ({ sessions: [] }));
                  setSessions((d.sessions ?? []).slice(0, 20));
                }}
              >
                list {agent} sessions
              </Button>
            )
          }
        >
          {sessions === null && <EmptyState className="py-6">Pick up a {agent} session started outside kraftwerk.</EmptyState>}
          {sessions === "loading" && <EmptyState className="py-6">asking {agent}…</EmptyState>}
          {Array.isArray(sessions) && sessions.length === 0 && <EmptyState className="py-6">no {agent} sessions in this project</EmptyState>}
          {Array.isArray(sessions) && sessions.length > 0 && (
            <div className="flex flex-col p-1.5">
              {sessions.map((s) => (
                <ListRow
                  key={s.sessionId}
                  size="sm"
                  title={s.title || s.sessionId.slice(0, 8)}
                  meta={s.updatedAt && new Date(s.updatedAt).toLocaleString()}
                  innerProps={{ title: s.sessionId }}
                  onClick={async () => {
                    if (creating) return;
                    setCreating(true);
                    await createChatAndOpen(agent, { kind: kraftwerkAware ? "kraftwerk" : "general" }, s.sessionId);
                    setCreating(false);
                  }}
                />
              ))}
            </div>
          )}
        </Panel>
      )}
    </Page>
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

/**
 * Who an agent's turn is from, the way a reader says it: "🐻 Max", "🎩 Ralv".
 * The waiting line, the approval and question cards and the composer all
 * name the agent instead of saying "the agent".
 */
const SpeakerContext = createContext<(from?: Author) => string>(() => "The agent");
const useSpeaker = () => useContext(SpeakerContext);

/** Who asked the first request nobody answered yet: undefined = none, null = the chat's one agent. */
function pendingFrom(events: StoredChatEvent[]): Author | null | undefined {
  const open = new Map<string, Author | null>();
  for (const e of events) {
    if (e.type === "permission_request" || e.type === "elicitation_request") open.set(e.requestId, e.from ?? null);
    if (e.type === "permission_resolved" || e.type === "elicitation_resolved") open.delete(e.requestId);
  }
  return open.size ? [...open.values()][0] : undefined;
}

/** The name a chat's single agent goes by. */
function mainSpeaker(scope: ChatScope, agents: Agent[], agentName?: string): string {
  if (scope.kind === "agent") {
    const a = agents.find((x) => x.slug === scope.slug);
    return a ? `${a.emoji ? `${a.emoji} ` : ""}${a.name}` : (agentName ?? scope.slug);
  }
  if (scope.kind === "general" || scope.kind === "kraftwerk") return "🎩 Ralv";
  return "The assistant";
}

export function ChatThread({
  id,
  agentName,
  agentDescription,
  channel,
  agents,
  onConverted,
}: {
  id: string;
  agentName?: string;
  agentDescription?: string;
  /** Channel mode: several agents, signed messages, @mentions. */
  channel?: Channel;
  agents?: Agent[];
  /** A project chat took coworkers: the host re-renders it as a channel session in place. */
  onConverted?: (channelSlug: string) => void;
}) {
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [events, setEvents] = useState<StoredChatEvent[]>([]);
  const [gone, setGone] = useState(false);
  const [coworker, setCoworker] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkNote, setForkNote] = useState<string | null>(null);
  // Channels: look at one agent's own session (its stream alone, tools included).
  const [focus, setFocus] = useState<string | null>(null);
  const features = useFeatures();
  const expert = useExpertMode();
  const allAgents = usePoll<{ agents: Agent[] }>(channel ? "" : "/api/agents", false, 30_000)?.agents ?? [];
  // An attached app shows in the context column: announce it, and render the
  // pane into the column's slot once it is in the DOM.
  const attachedSlug = meta?.vibeable && features.vibeables ? meta.vibeable : null;
  const [vibeSlot, setVibeSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!attachedSlug) return setVibeSlot(null);
    announceVibeable({ chatId: id, slug: attachedSlug });
    setVibeSlot(document.getElementById(VIBE_SLOT_ID));
    return () => announceVibeable(null);
  }, [id, attachedSlug]);
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

  if (gone) return <EmptyState icon="chat_error">chat not found</EmptyState>;
  if (!meta) return <EmptyState>loading…</EmptyState>;

  const agentMap = new Map((agents ?? []).map((a) => [a.slug, a]));

  if (channel) {
    return (
      <div className="chat-thread flex min-h-0 w-full flex-1 animate-rise flex-col">
        <div className="channel-head flex flex-none flex-wrap items-center gap-x-3 gap-y-2 pb-1.5">
          <Dot tone={busy ? "working" : "ok"} />
          <Title>#{channel.slug}</Title>
          <span className="text-md text-fg-2">{channel.name}</span>
          <span className="flex-1" />
          {working.length > 0 && (
            <Button size="sm" variant="danger" icon="stop" title="interrupt every agent working in this channel" onClick={() => stopAgent(id)}>
              stop all ({working.length})
            </Button>
          )}
          <Button size="sm" icon="tune" href={`/channels/${encodeURIComponent(channel.slug)}/edit`} title="members, purpose, responder">
            members
          </Button>
        </div>
        <div className="channel-members flex flex-none flex-wrap items-center gap-x-2.5 gap-y-2 pb-3">
          {channel.purpose && <span className="channel-purpose w-full text-sm text-fg-2">{channel.purpose}</span>}
          {channel.members.map((m) => {
            const a = agentMap.get(m);
            const on = working.includes(m);
            const act = agentActivity(events, m);
            return (
              <div
                key={m}
                className={cn(
                  "member-chip inline-flex items-center gap-1 rounded-full py-[3px] pr-1.5 pl-[3px] text-sm transition-colors",
                  on ? "bg-accent-soft" : "bg-surface-2",
                  focus === m && "outline-2 outline-accent"
                )}
                title={a?.description}
              >
                <button
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
                  onClick={() => setFocus(focus === m ? null : m)}
                  title={focus === m ? "back to the channel" : `look at @${m}'s session`}
                >
                  <span className="relative grid size-7 flex-none place-items-center rounded-full bg-surface text-[15px]">
                    <span aria-hidden>{a?.emoji ?? "🤖"}</span>
                    <span className="absolute -right-0.5 -bottom-0.5 grid rounded-full bg-surface p-px">
                      <Dot tone={on ? "working" : "idle"} />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-px">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-medium text-fg">{a?.name ?? m}</span>
                      <span className="member-handle font-mono text-2xs text-fg-2">@{m}</span>
                      {channel.responder === m && <Tag>responder</Tag>}
                    </span>
                    {(act.task || act.now) && (
                      <span className="max-w-[44ch] truncate text-2xs text-fg-2">
                        {on ? (
                          act.now ? (
                            <>
                              <Eyebrow className="mr-1">now</Eyebrow> {act.now}
                            </>
                          ) : (
                            <>working on: {act.task}</>
                          )
                        ) : (
                          <>
                            <Eyebrow className="mr-1">last</Eyebrow> {act.task}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </button>
                {on && <IconButton icon="stop" label={`interrupt @${m}`} variant="danger" size="sm" className="size-6" onClick={() => stopAgent(id, m)} />}
                <IconButton icon="info" label="agent definition" size="sm" className="size-6" href={`/agents/${encodeURIComponent(m)}/info`} />
              </div>
            );
          })}
        </div>
        {focus && (
          <div className="flex flex-none items-center gap-2.5 border-b border-line py-1.5 text-sm">
            <Button size="sm" variant="quiet" icon="arrow_back" onClick={() => setFocus(null)}>
              channel
            </Button>
            <span className="min-w-0 truncate text-fg-2">
              {agentMap.get(focus)?.emoji ?? "🤖"} @{focus}'s session — everything this agent did, tools included
            </span>
            <span className="flex-1" />
            {working.includes(focus) && (
              <Button size="sm" variant="danger" icon="stop" onClick={() => stopAgent(id, focus)}>
                stop @{focus}
              </Button>
            )}
          </div>
        )}
        <SpeakerContext.Provider
          value={(from) => {
            const a = from?.kind === "agent" ? agentMap.get(from.slug) : undefined;
            return from?.kind === "agent" ? `${a?.emoji ?? "🤖"} ${a?.name ?? from.slug}` : "The agent";
          }}
        >
          <Thread id={id} events={events} busy={busy} channel={channel} agentMap={agentMap} working={working} focus={focus ?? undefined} />
          <Composer id={id} busy={busy} scope={meta.scope} channel={channel} agentMap={agentMap} />
        </SpeakerContext.Provider>
      </div>
    );
  }

  const waiting = busy && pendingFrom(events) !== undefined;
  return (
    <>
    <div className="chat-thread flex min-h-0 w-full flex-1 animate-rise flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 pb-1.5">
        <Dot tone={waiting ? "bad" : busy ? "working" : "ok"} title={waiting ? "waiting for you" : busy ? "working" : undefined} />
        <Title className="min-w-0">{title || "new chat"}</Title>
        {((meta.scope.kind === "agent" && !meta.scope.routine) || meta.scope.kind === "project") && (
          <Button
            size="sm"
            icon="group_add"
            onClick={() => setCoworker(true)}
            title={meta.scope.kind === "project" ? "Turn this chat into a channel of the project and invite agents" : "Turn this chat into a channel and invite more agents"}
            disabled={busy}
          >
            add coworker
          </Button>
        )}
        {expert && meta.agent !== "pi" && meta.sessions?.main && (
          <Button
            size="sm"
            variant="quiet"
            icon="call_split"
            busy={forking}
            className={meta.agent === "codex" ? "opacity-50" : undefined}
            disabled={busy}
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
            {forking ? "forking…" : "fork"}
          </Button>
        )}
        {expert && forkNote && <span className="text-2xs text-fg-2">{forkNote}</span>}
        {expert && <Tag>{meta.agent}</Tag>}
        <AgentStatus id={id} live={live} />
        {expert && meta.scope.kind === "run" && <TagLink href={`/runs/${meta.scope.runId}`}>{meta.scope.runId}</TagLink>}
        {expert && meta.scope.kind === "kraftwerk" && <Tag>kraftwerk-aware</Tag>}
        {expert && meta.scope.kind === "knowledge" && (
          <TagLink href={meta.scope.bundle ? `/knowledge/${encodeURIComponent(meta.scope.bundle)}` : "/knowledge"}>
            knowledge{meta.scope.bundle ? `:${meta.scope.bundle}` : ""}
          </TagLink>
        )}
        {expert && meta.scope.kind === "agent" && <TagLink href={`/agents/${encodeURIComponent(meta.scope.slug)}/info`}>agent:{meta.scope.slug}</TagLink>}
        {expert && (
          <span className="rid max-w-[34ch] min-w-0 truncate font-mono text-xs text-fg-2" title={meta.cwd}>
            {meta.cwd}
          </span>
        )}
      </div>
      {meta.vibeable && !features.vibeables && <VibeOffNote chatId={id} slug={meta.vibeable} onClosed={setMeta} />}
      <SpeakerContext.Provider value={() => mainSpeaker(meta.scope, allAgents, agentName)}>
        <Thread id={id} events={events} busy={busy} />
        <Composer id={id} busy={busy} scope={meta.scope} commands={live.commands} canSteer={meta.agent !== "pi"} />
      </SpeakerContext.Provider>
    </div>
    {attachedSlug && vibeSlot && createPortal(<VibePane key={attachedSlug} chatId={id} slug={attachedSlug} agentBusy={busy} onClosed={setMeta} />, vibeSlot)}
    {coworker && meta.scope.kind === "agent" && (
      <AddCoworkerDialog chatId={id} agentSlug={meta.scope.slug} title={title} onClose={() => setCoworker(false)} />
    )}
    {coworker && meta.scope.kind === "project" && (
      <AddCoworkerDialog chatId={id} project={meta.scope.slug} title={title || agentName || ""} onClose={() => setCoworker(false)} onCreated={onConverted} />
    )}
    </>
  );
}

/** A status tag that links somewhere: the run, the bundle, the agent a chat is about. */
function TagLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="no-underline hover:opacity-80">
      <Tag>{children}</Tag>
    </Link>
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
  const speaker = useSpeaker();
  const waitingFrom = useMemo(() => pendingFrom(events), [events]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [blocks, busy]);

  return (
    <div
      className="-mx-5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[22px] pt-3.5 pb-5 [&>:nth-last-child(-n+3)]:animate-rise"
      ref={scrollRef}
      onClick={onBrowseClick}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {blocks.length === 0 && (
        <EmptyState className="m-auto">
          {channel
            ? `say something — @mention an agent to wake it${channel.responder ? `, or just write: @${channel.responder} answers` : ""}`
            : "say something — the agent starts on your first message"}
        </EmptyState>
      )}
      {blocks.map((b, i) => {
        // Channels: a byline whenever the author changes.
        const prev = blocks[i - 1];
        const byline = channel && b.kind !== "error" && (!prev || !sameAuthor(prev.from, b.from) || prev.kind === "error") ? b.from : undefined;
        return (
          <div key={b.key} className="contents">
            {byline && <Byline from={byline} agentMap={agentMap} />}
            <BlockView b={b} chatId={id} />
          </div>
        );
      })}
      {busy && waitingFrom !== undefined && (
        // A turn that stopped for an approval or a question is not working: it waits for you.
        <div className="chat-working waiting flex animate-breathe items-center gap-2 text-xs font-semibold text-bad">
          <Dot tone="bad" /> {speaker(waitingFrom ?? undefined)} is waiting for you
        </div>
      )}
      {busy && waitingFrom === undefined && (
        <div className="chat-working flex animate-breathe items-center gap-2 text-xs text-fg-2">
          <Dot tone="working" />{" "}
          {channel && working?.length
            ? working.map((w) => `${agentMap?.get(w)?.emoji ?? ""} @${w}`).join(", ") + (working.length === 1 ? " is working…" : " are working…")
            : `${speaker()} is working…`}
        </div>
      )}
    </div>
  );
}

/** Channel byline: who says the next message(s). */
function Byline({ from, agentMap }: { from: Author; agentMap?: Map<string, Agent> }) {
  const line = "mt-2.5 -mb-0.5 inline-flex items-center gap-2 text-sm text-fg-2 no-underline";
  const avatar = "grid size-[22px] place-items-center rounded-full text-xs font-semibold";
  if (from.kind === "human") {
    return (
      <div className={cn("byline human self-end", line)}>
        <span className={cn(avatar, "bg-accent text-on-accent")}>{from.name.slice(0, 1).toUpperCase()}</span>
        <span className="byline-name font-semibold text-fg">{from.name}</span>
      </div>
    );
  }
  const a = agentMap?.get(from.slug);
  return (
    <Link href={`/agents/${encodeURIComponent(from.slug)}/info`} className={cn("byline agent self-start", line)}>
      <span className={cn(avatar, "bg-accent-soft text-on-accent-soft")}>{a?.emoji ?? "🤖"}</span>
      <span className="byline-name font-semibold text-fg">{a?.name ?? from.slug}</span>
      <span className="font-mono text-2xs">@{from.slug}</span>
    </Link>
  );
}

/** Agent replies are markdown — render them (sanitized; images/links included). */
function AgentMessage({ text, small }: { text: string; small?: boolean }) {
  // Every external link gets a small icon that opens it in the context column's browser.
  const html = useMemo(() => withBrowseIcons(DOMPurify.sanitize(marked.parse(text, { async: false }))), [text]);
  return (
    <div
      className={cn(
        "md-body h-auto self-stretch overflow-visible p-0 break-words text-fg",
        small ? "font-sans text-[12.5px] leading-[1.6]" : "font-reading text-[17px] leading-[1.62]",
        "[&_img]:my-1 [&_img]:block [&_img]:rounded-xl [&_pre]:max-w-full"
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** What the agent did, one line each: a dot for how it went, the kind, then the command or title. */
function Activity({ tone, kind, kindTone, children, extra }: { tone: DotTone; kind?: string; kindTone?: "ask"; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex max-w-[90ch] items-start gap-2 self-start px-0.5 font-mono text-2xs text-fg-2">
      <span className="mt-[3px] grid">
        <Dot tone={tone} />
      </span>
      <span className={cn("min-w-16 shrink-0 text-[10px] tracking-[0.5px] uppercase", kindTone === "ask" && "text-ask")}>{kind}</span>
      <span className="min-w-0 leading-[1.5] break-words whitespace-pre-wrap">{children}</span>
      {extra}
    </div>
  );
}

const stateTone = (state?: string, running: DotTone = "working"): DotTone =>
  state === "completed" ? "ok" : state === "failed" ? "bad" : state === "running" || state === undefined ? running : "idle";

function BlockView({ b, chatId, nested }: { b: Block; chatId: string; nested?: boolean }) {
  switch (b.kind) {
    case "user":
      return (
        <div
          className={cn(
            "msg user -mx-[22px] my-1.5 self-stretch bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface-1))] px-[22px] py-4 text-md leading-[1.55] break-words whitespace-pre-wrap text-fg",
            b.steered && "border-l-[3px] border-ask"
          )}
        >
          {b.steered && <Eyebrow className="mb-0.5 block text-[10px] opacity-70">steered in</Eyebrow>}
          {b.text}
          {b.attachments && b.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {b.attachments.map((a) => {
                const href = `/api/chats/${chatId}/attachments/${encodeURIComponent(a.name)}`;
                return a.mimeType.startsWith("image/") ? (
                  <a key={a.name} href={href} target="_blank" rel="noreferrer" title={a.name}>
                    <img src={href} alt={a.name} className="block max-h-60 max-w-full rounded-lg" />
                  </a>
                ) : (
                  <a key={a.name} className="inline-flex items-center gap-1 text-xs text-inherit underline" href={href} target="_blank" rel="noreferrer">
                    <Icon name="attach_file" className="ms-sm" /> {a.name}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      );
    case "agent":
      return <AgentMessage text={b.text} small={nested} />;
    case "thought":
      return (
        <details className="self-stretch">
          <summary className="cursor-pointer text-xs font-medium text-fg-2 select-none">thinking</summary>
          <div className="mt-1 border-l-2 border-line px-3 py-2 text-xs break-words whitespace-pre-wrap text-fg-2">{b.text}</div>
        </details>
      );
    case "tool":
      return (
        <Activity tone={b.status === "completed" ? "ok" : b.status === "failed" ? "bad" : "working"} kind={b.compaction ? "compact" : b.toolKind} kindTone={b.compaction ? "ask" : undefined}>
          {b.compaction ? compactionLabel(b.compaction, b.status) : b.title}
        </Activity>
      );
    case "subagent":
      return (
        <details className="max-w-[90ch] self-stretch" open={!b.state}>
          <summary className="cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
            <Activity tone={stateTone(b.state)} kind="subagent">
              <b>{b.name}</b> — {b.task}
              {b.state && b.state !== "completed" && <span className="opacity-70"> · {b.state}</span>}
            </Activity>
          </summary>
          <div className="mt-1.5 mb-1 ml-[3px] flex flex-col gap-2.5 border-l-2 border-line py-1.5 pl-3.5">
            {b.children.length === 0 && <div className="font-mono text-2xs text-fg-2 opacity-70">working…</div>}
            {b.children.map((c) => (
              <BlockView key={c.key} b={c} chatId={chatId} nested />
            ))}
          </div>
        </details>
      );
    case "task":
      return (
        <Activity
          tone={stateTone(b.state, "working")}
          kind={b.taskType}
          kindTone="ask"
          extra={
            b.canStop &&
            (b.state === "running" || b.state === "paused") && (
              <button
                type="button"
                className="ml-2 cursor-pointer rounded-lg border border-line bg-transparent px-1.5 py-px font-[inherit] text-[10px] tracking-[0.5px] text-inherit uppercase hover:border-bad hover:text-bad"
                title="stop this background task (the turn goes on)"
                onClick={() =>
                  fetch(`/api/chats/${chatId}/task-stop`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ taskId: b.taskId }),
                  }).catch(() => {})
                }
              >
                stop
              </button>
            )
          }
        >
          <b>{b.name}</b> — {b.summary ?? b.description}
          {b.state && b.state !== "running" && b.state !== "completed" && <span className="opacity-70"> · {b.state}</span>}
        </Activity>
      );
    case "plan":
      return (
        <div className={cn("max-w-[76ch] self-start rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-fg-2", b.removed && "opacity-55")}>
          <div className="mb-1 flex items-baseline gap-2">
            <Eyebrow>plan</Eyebrow>
            <span className="font-mono text-2xs">
              {b.entries.filter((e) => e.status === "completed").length}/{b.entries.length}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
            {b.entries.map((e, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-1.5 leading-[1.45]",
                  e.status === "completed" && "line-through opacity-60",
                  e.status === "in_progress" && "font-semibold text-fg"
                )}
              >
                <Icon
                  name={e.status === "completed" ? "check_circle" : e.status === "in_progress" ? "play_circle" : "radio_button_unchecked"}
                  className={cn("ms-sm mt-0.5 shrink-0", e.status === "in_progress" && "text-accent")}
                />
                <span>{e.content}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "files":
      return (
        <Activity tone="ok" kind="changed">
          {b.paths.join("\n")}
          {(!b.complete || b.note) && <span className="opacity-70"> · {b.note ?? "list may be incomplete"}</span>}
        </Activity>
      );
    case "question":
      return <QuestionCard b={b} chatId={chatId} />;
    case "permission":
      return <PermissionCard b={b} chatId={chatId} />;
    case "error":
      return (
        <div className="flex items-center gap-1 self-start text-[12.5px] text-bad">
          <Icon name="error" className="ms-sm" /> {b.text}
        </div>
      );
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
    <div
      className={cn(
        "max-w-[76ch] self-start rounded-2xl px-4 py-3",
        f.severity === "warning" ? "bg-ask-soft text-on-ask-soft" : "bg-bad-soft text-on-bad-soft",
        !live && "opacity-70"
      )}
    >
      <div className="flex items-center gap-1.5 text-[13.5px]">
        <Icon name={f.severity === "warning" ? "warning" : "error"} className="ms-sm" />
        <Eyebrow className="mr-1 font-bold text-inherit">{f.category}</Eyebrow> {f.title}
      </div>
      {f.details && <div className="mt-1.5 text-xs break-words whitespace-pre-wrap">{f.details}</div>}
      {note && <div className="mt-1.5 text-xs break-words whitespace-pre-wrap">{note}</div>}
      {live && f.actions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {f.actions.map((a) => (
            <Button key={a} size="sm" disabled={sending} className="border-current text-inherit" onClick={() => act(a)}>
              {FAILURE_ACTION_LABEL[a]}
            </Button>
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
        <span title={[live.auth.detail, live.auth.email, live.auth.organization, live.auth.plan].filter(Boolean).join(" · ")}>
          <Tag tone={live.auth.kind === "none" ? "bad" : "neutral"}>
            <Icon name={live.auth.kind === "none" ? "person_off" : "person"} className="ms-sm mr-1" /> {live.auth.email ?? live.auth.label}
          </Tag>
        </span>
      )}
      {expert && live.usage && live.usage.size > 0 && (
        <span className="font-mono" title={`${live.usage.used.toLocaleString()} of ${live.usage.size.toLocaleString()} context tokens${live.usage.costUsd != null ? ` · $${live.usage.costUsd.toFixed(2)} so far` : ""}`}>
          <Tag>
            {Math.round((100 * live.usage.used) / live.usage.size)}% ctx
            {live.usage.costUsd != null && ` · $${live.usage.costUsd.toFixed(2)}`}
          </Tag>
        </span>
      )}
      {expert &&
        shown.map((o) =>
          o.type === "select" ? (
            <Select
              key={o.id}
              className="h-7 w-auto max-w-[22ch] px-2 pr-6 text-xs text-fg-2"
              value={o.value}
              disabled={busyId === o.id}
              title={o.description ?? o.name}
              aria-label={o.name}
              onChange={(e) => change(o, e.target.value)}
            >
              {o.choices.map((c) => (
                <option key={c.value} value={c.value} title={c.description}>
                  {c.group ? `${c.group} · ` : ""}{c.name}
                </option>
              ))}
            </Select>
          ) : (
            <label key={o.id} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fg-2" title={o.description ?? o.name}>
              <input type="checkbox" className="accent-accent" checked={o.value} disabled={busyId === o.id} onChange={(e) => change(o, e.target.checked)} /> {o.name}
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
  const speaker = useSpeaker();
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
    <Ask className={cn("question-card", pending && "pending")} requestId={b.requestId} who={`${speaker(b.from)} asks`} what={b.message}>
      {pending ? (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {b.fields.map((f) => (
            <label key={f.key} className={cn("flex flex-col gap-1.5 text-sm", f.custom && "-mt-1")}>
              {(f.title || f.description) && !f.custom && (
                <span>
                  {f.title && <b>{f.title}</b>}
                  {f.description && <span className="opacity-85"> {f.description}</span>}
                </span>
              )}
              {f.kind === "select" && (
                <div className="flex flex-wrap gap-1.5">
                  {f.options?.map((o) => (
                    <Button key={o.value} size="sm" variant={values[f.key] === o.value ? "primary" : "secondary"} title={o.description} onClick={() => set(f.key, o.value)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
              {f.kind === "multiselect" && (
                <div className="flex flex-wrap gap-1.5">
                  {f.options?.map((o) => {
                    const cur = (values[f.key] as string[] | undefined) ?? [];
                    const on = cur.includes(o.value);
                    return (
                      <Button key={o.value} size="sm" variant={on ? "primary" : "secondary"} title={o.description} onClick={() => set(f.key, on ? cur.filter((v) => v !== o.value) : [...cur, o.value])}>
                        {o.label}
                      </Button>
                    );
                  })}
                </div>
              )}
              {f.kind === "text" && (
                <TextField
                  className="max-w-[60ch]"
                  placeholder={f.custom ? "or type your own answer" : (f.title ?? f.key)}
                  value={(values[f.key] as string | undefined) ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.kind === "number" && (
                <TextField
                  type="number"
                  className="max-w-[60ch]"
                  value={(values[f.key] as number | undefined) ?? ""}
                  onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))}
                />
              )}
              {f.kind === "boolean" && (
                <span>
                  <input type="checkbox" className="accent-accent" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> {f.title ?? f.key}
                </span>
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={sending || missing} onClick={() => answer("accept")}>
              answer
            </Button>
            <Button disabled={sending} onClick={() => answer("decline")}>
              skip
            </Button>
          </div>
        </div>
      ) : (
        <Resolved>
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
        </Resolved>
      )}
    </Ask>
  );
}

/**
 * The agent stopped for you: an approval or a question, read as a sentence
 * (who asks, then what). `perm-card`, `pending` and `data-request` are what
 * "next" finds and lights up (attention.tsx).
 */
function Ask({ className, requestId, who, what, children }: { className?: string; requestId: string; who: string; what: string; children: React.ReactNode }) {
  return (
    <div className={cn("perm-card max-w-[76ch] self-start rounded-2xl bg-ask-soft px-4 py-3 text-on-ask-soft", className)} data-request={requestId}>
      <div className="flex flex-col gap-[3px]">
        <span className="perm-who text-[12.5px] font-semibold text-fg-2">{who}</span>
        <span className="text-base font-semibold [overflow-wrap:anywhere] text-fg">{what}</span>
      </div>
      {children}
    </div>
  );
}

function Resolved({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 font-mono text-xs text-fg-2">{children}</div>;
}

function PermissionCard({
  b,
  chatId,
}: {
  b: Extract<Block, { kind: "permission" }>;
  chatId: string;
}) {
  const [sending, setSending] = useState(false);
  const speaker = useSpeaker();
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
    <Ask className={cn(pending && "pending")} requestId={b.requestId} who={`${speaker(b.from)} asks for your OK`} what={b.title}>
      {pending ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {b.options.map((o) => (
            <Button key={o.optionId} variant={o.kind?.startsWith("allow") ? "primary" : "secondary"} disabled={sending} title={o.name} onClick={() => answer(o.optionId)}>
              {optionLabel(o)}
            </Button>
          ))}
        </div>
      ) : (
        <Resolved>
          {b.resolved
            ? `→ ${(() => {
                const o = b.options.find((x) => x.optionId === b.resolved);
                return o ? optionLabel(o) : b.resolved;
              })()}`
            : gone
              ? `→ ${gone}`
              : "→ dismissed"}
        </Resolved>
      )}
    </Ask>
  );
}

/** A permission option in plain words, by its kind; the adapter's own name stays as the tooltip. */
function optionLabel(o: { name: string; kind?: string }): string {
  if (o.kind === "allow_once") return "Allow";
  if (o.kind === "allow_always") return "Always allow";
  if (o.kind === "reject_once") return "Don't allow";
  if (o.kind === "reject_always") return "Never allow";
  return o.name;
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
  // "Max", "Ralv", "the assistant": the name without its emoji, for the placeholder.
  const name = useSpeaker()().replace(/^\S+\s(?=\S)/u, (m) => (/\p{Extended_Pictographic}/u.test(m) ? "" : m)).replace(/^The /, "the ");
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
      className="composer relative flex flex-none flex-wrap items-end border-t border-line pt-2.5 pb-1"
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
        <div className="flex basis-full flex-wrap gap-1.5 px-1 pb-1.5">
          {files.map((f) => (
            <span key={f.name} className={FILE_CHIP} title={`${f.name} · ${Math.round(f.size / 1024)} KB`}>
              {f.preview ? <img src={f.preview} alt={f.name} className="h-7 rounded" /> : <Icon name="attach_file" className="ms-sm" />}
              {f.name.replace(/^\d{8}-\d{6}-/, "")}
              <button
                type="button"
                className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-fg"
                title="remove"
                aria-label={`remove ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
              >
                <Icon name="close" className="ms-sm" />
              </button>
            </span>
          ))}
          {uploading > 0 && <span className={FILE_CHIP}>uploading…</span>}
        </div>
      )}
      {channel && (
        <div className="composer-me flex basis-full items-center gap-1.5 px-1 pb-1 text-xs text-fg-2">
          posting as{" "}
          {editingMe ? (
            <TextField
              autoFocus
              className="h-7 w-48 text-xs"
              value={me}
              placeholder="your name"
              aria-label="your name"
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
            <button
              type="button"
              className="me-name inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] font-semibold text-fg"
              onClick={() => setEditingMe(true)}
              title="change your name"
            >
              {me || "you"} <Icon name="edit" className="ms-sm" />
            </button>
          )}
        </div>
      )}
      {menuOpen && (
        <div className="skill-menu absolute inset-x-0 bottom-full z-5 mb-1.5 flex max-h-[46vh] flex-col overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop">
          {matches.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                "flex cursor-pointer items-center gap-1.5 border-0 px-3.5 py-2 text-left text-sm whitespace-nowrap text-fg",
                i === selIdx ? "bg-surface-2" : "bg-transparent hover:bg-surface-2"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                s.pick();
              }}
            >
              <b className="max-w-[42%] flex-none truncate font-mono text-[12.5px] font-medium">{s.label}</b>
              {s.hint && <span className="min-w-0 flex-1 truncate text-xs text-fg-2">— {s.hint}</span>}
              {s.src && <span className="ml-auto flex-none text-[10.5px] tracking-[0.04em] text-fg-2 uppercase">{s.src}</span>}
            </button>
          ))}
        </div>
      )}
      {problem && (
        <div className="basis-full">
          <Notice tone="bad">{problem}</Notice>
        </div>
      )}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-end gap-0.5 rounded-[24px] border bg-surface py-[5px] pr-[5px] pl-3.5 transition-[border-color,box-shadow]",
          "focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_16%,transparent)]",
          dragging ? "border-dashed border-accent" : "border-line"
        )}
      >
        <textarea
          ref={taRef}
          value={text}
          className="max-h-[40vh] min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-1.5 py-2 font-sans text-md leading-[1.5] text-fg shadow-none outline-none [field-sizing:content] placeholder:text-fg-2"
          placeholder={
            channel
              ? locked ? "the agents are working…" : "Message the channel…"
              : locked
                ? `${name} is working…`
                : steering
                  ? `Add to what ${name} is doing…`
                  : `Message ${name}…`
          }
          title={channel ? "Enter to send · Shift+Enter for a newline · @ mentions an agent · / for skills · drop or paste files" : "Enter to send · Shift+Enter for a newline · / for skills · drop or paste files"}
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
          <Button size="sm" variant="danger" icon="stop" className="mr-1 self-center" onClick={() => fetch(`/api/chats/${id}/cancel`, { method: "POST" }).catch(() => {})}>
            stop
          </Button>
        )}
        {!locked && <IconButton icon="attach_file" label="attach files (or drop / paste them)" className="size-9 rounded-full [&_.ms]:text-[20px]" onClick={() => fileRef.current?.click()} />}
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
          <button
            type="button"
            className="inline-grid size-9 flex-none cursor-pointer place-items-center rounded-full border-0 bg-accent p-0 text-on-accent transition-[filter,opacity] hover:enabled:brightness-110 active:enabled:scale-95 disabled:cursor-default disabled:opacity-30"
            disabled={(!text.trim() && files.length === 0) || uploading > 0}
            onClick={send}
            aria-label={steering ? "steer" : "send"}
            title={steering ? "steer: hand this into the running turn (Enter)" : "send (Enter)"}
          >
            <Icon name={steering ? "alt_route" : "send"} className="text-[19px]" />
          </button>
        )}
      </div>
    </div>
  );
}

const FILE_CHIP = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs text-fg-2";
