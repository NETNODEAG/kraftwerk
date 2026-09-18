import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  answerPermission,
  cancelChat,
  createAgentChat,
  createGeneralChat,
  declineElicitation,
  getChat,
  listChats,
  sendMessage,
  listAgents,
  listChannels,
  type Agent,
  type Author,
  type Channel,
  type ChatEvent,
  type ChatSummary,
  type Harness,
  type RunListItem,
} from "./api";
import { AgentModal } from "./agent-modal";
import { ChannelModal } from "./channel-modal";
import { Markdown } from "./markdown";
import { useMedia } from "./menu";
import { GENERAL, SessionPicker, TargetPicker, TargetSidebar, channelOf, channelTarget, isSessionOf } from "./pickers";
import { RUN_MARK, runEnded, runLine, runReport, type UiRun } from "./runs";

const HARNESSES: Harness[] = ["claude", "codex", "pi"];
const HARNESS_KEY = "kw-next-harness";
/** The name that signs messages in channels; the inspector keeps its own under another key. */
const ME_KEY = "kw-next-me";

/** Browser storage is a convenience here, never required: every access may throw. */
const stored = {
  get: (key: string): string => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set: (key: string, value: string): void => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private window, blocked storage */
    }
  },
};

type Block =
  /** `from` is set in channels only, where a message needs its author shown. */
  | { kind: "user" | "agent" | "error"; key: string; text: string; from?: Author }
  /** The report of a run started with Run! (runReport): a card, not the prose the agent was sent. */
  | { kind: "run"; key: string; title: string; request?: string; runId?: string }
  /** A stretch of tool calls, shown as one line: what the agent is doing, not how. */
  | { kind: "activity"; key: string; count: number; last: string; open: boolean }
  | { kind: "permission"; key: string; requestId: string; title: string; options: { optionId: string; name: string; kind?: string }[]; answer?: string | null }
  | { kind: "question"; key: string; requestId: string; message: string; resolved: boolean };

const sameAuthor = (a?: Author, b?: Author): boolean =>
  a?.kind === b?.kind && (a?.kind === "agent" ? a.slug === (b as typeof a).slug : a?.kind === "human" ? a.name === (b as typeof a).name : true);

/** The agents of a channel that are in the middle of a turn. */
function working(events: ChatEvent[]): string[] {
  const open = new Set<string>();
  for (const ev of events) {
    if (ev.from?.kind !== "agent") continue;
    if (ev.type === "turn_start") open.add(ev.from.slug);
    else if (ev.type === "turn_end") open.delete(ev.from.slug);
  }
  return [...open];
}

/** Fold the event stream (text arrives as deltas) into what the thread shows. */
function toBlocks(events: ChatEvent[]): Block[] {
  const blocks: Block[] = [];
  const calls = new Map<string, Extract<Block, { kind: "activity" }>>();
  for (const ev of events) {
    const last = blocks[blocks.length - 1];
    const key = `e${ev.seq}`;
    switch (ev.type) {
      case "user_message":
        if (ev.text.startsWith(RUN_MARK)) {
          const lines = ev.text.split("\n");
          blocks.push({
            kind: "run",
            key,
            title: lines[0].slice(RUN_MARK.length),
            request: lines.find((l) => l.startsWith("Request: "))?.slice(9),
            runId: lines.find((l) => l.startsWith("Run folder: "))?.split("/").pop(),
          });
        } else blocks.push({ kind: "user", key, text: ev.text, from: ev.from });
        break;
      case "text":
        if (ev.subagent) break;
        // Deltas continue a message only of the same author: in a channel two agents may answer at once.
        if (last?.kind === "agent" && sameAuthor(last.from, ev.from)) last.text += ev.text;
        else blocks.push({ kind: "agent", key, text: ev.text, from: ev.from });
        break;
      case "tool_call": {
        const activity = last?.kind === "activity" ? last : { kind: "activity" as const, key, count: 0, last: "", open: true };
        if (activity !== last) blocks.push(activity);
        activity.count++;
        activity.last = ev.title;
        calls.set(ev.callId, activity);
        break;
      }
      case "tool_update": {
        const activity = calls.get(ev.callId);
        if (activity && ev.title) activity.last = ev.title;
        break;
      }
      case "permission_request":
        blocks.push({ kind: "permission", key, requestId: ev.requestId, title: ev.title, options: ev.options });
        break;
      case "permission_resolved": {
        const card = blocks.find((b) => b.kind === "permission" && b.requestId === ev.requestId);
        if (card?.kind === "permission") {
          card.answer = ev.optionId === null ? null : (card.options.find((o) => o.optionId === ev.optionId)?.name ?? ev.optionId);
        }
        break;
      }
      case "elicitation_request":
        blocks.push({ kind: "question", key, requestId: ev.requestId, message: ev.message, resolved: false });
        break;
      case "elicitation_resolved": {
        const card = blocks.find((b) => b.kind === "question" && b.requestId === ev.requestId);
        if (card?.kind === "question") card.resolved = true;
        break;
      }
      case "failure":
        blocks.push({ kind: "error", key, text: ev.details ? `${ev.title} — ${ev.details}` : ev.title });
        break;
      case "error":
        blocks.push({ kind: "error", key, text: ev.message });
        break;
      case "turn_end":
        for (const b of blocks) if (b.kind === "activity") b.open = false;
        break;
    }
  }
  return blocks;
}

/**
 * The conversation panel. The title picks who is talked to (the general
 * assistant or one of the workspace's agents), the session picker which of
 * the conversations with them. A session is created with its first message;
 * afterwards the thread follows its SSE stream. `workspaceKey` keeps what is
 * remembered apart per instance (in dev one origin serves several of them).
 */
export function Chat({ workspaceKey, runs, outputDir, pending, compose, onSettled, onOpenRun }: {
  workspaceKey: string;
  /** null until the first poll answered. */
  runs: RunListItem[] | null;
  outputDir: string;
  /** Runs started with Run! whose result this chat still owes the user. */
  pending: UiRun[];
  /** A message written elsewhere on the page (a workflow's modal); `n` makes a repeat count. */
  compose: { text: string; n: number } | null;
  onSettled: (runId: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  const targetKey = `kw-next-target:${workspaceKey}`;
  const [target, setTarget] = useState(() => stored.get(targetKey) || GENERAL);
  // Each target remembers its own session ("new" = the user asked for a fresh one).
  const chatKey = `kw-next-chat:${workspaceKey}:${target}`;
  const [agents, setAgents] = useState<Agent[]>([]);
  /** null until loaded: a remembered channel must not be given up before the list is there. */
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [me, setMe] = useState(() => stored.get(ME_KEY));
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [harness, setHarness] = useState<Harness>(() => (HARNESSES.find((h) => h === stored.get(HARNESS_KEY)) ?? "claude"));
  const thread = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);

  const refreshChats = useCallback(() => listChats().then(setChats).catch(() => {}), []);

  /** undefined = closed, null = a new channel, else the slug being edited. */
  const [editingChannel, setEditingChannel] = useState<string | null | undefined>(undefined);
  /** undefined = closed, null = a new agent, else the slug being edited. */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);

  const refreshAgents = useCallback(
    () =>
      listAgents()
        .then((list) => {
          setAgents(list);
          // A remembered agent that is gone since: back to the general chat.
          setTarget((t) => (t === GENERAL || channelOf(t) || list.some((a) => a.slug === t) ? t : GENERAL));
        })
        .catch(() => {}),
    []
  );

  useEffect(() => void refreshAgents(), [refreshAgents]);

  useEffect(() => {
    listChannels()
      .catch(() => [] as Channel[])
      .then((list) => {
        setChannels(list);
        setTarget((t) => (channelOf(t) && !list.some((c) => channelTarget(c.slug) === t) ? GENERAL : t));
      });
  }, []);

  // A channel is one shared thread: no sessions to pick, nobody is kept waiting, messages are signed.
  const channel = channels?.find((c) => channelTarget(c.slug) === target) ?? null;
  const inChannel = channelOf(target) !== null;
  const inChannelRef = useRef(inChannel);
  inChannelRef.current = inChannel;

  const pickTarget = useCallback(
    (t: string) => {
      stored.set(targetKey, t);
      setTarget(t);
    },
    [targetKey]
  );

  /** Show another session (null = a fresh one); the thread starts over. */
  const openSession = useCallback((id: string | null) => {
    setEvents([]);
    setBusy(false);
    setError("");
    pinned.current = true;
    setChatId(id);
  }, []);

  // Per target: the remembered session, else the most recent one with them.
  useEffect(() => {
    let alive = true;
    setReady(false);
    openSession(null);
    if (inChannel) {
      // The channel's one chat; until the channels are loaded there is nothing to open.
      if (channel) {
        openSession(channel.chatId);
        setReady(true);
      }
      return;
    }
    (async () => {
      const list = await listChats().catch(() => [] as ChatSummary[]);
      if (!alive) return;
      const mine = list.filter((c) => isSessionOf(c, target));
      const remembered = stored.get(chatKey);
      setChats(list);
      openSession(remembered === "new" ? null : (mine.find((c) => c.id === remembered) ?? mine[0])?.id ?? null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [chatKey, target, openSession, inChannel, channel?.chatId]);

  // Load the transcript, then follow the stream from where it ends.
  useEffect(() => {
    if (!chatId) return;
    let source: EventSource | null = null;
    let alive = true;
    (async () => {
      const chat = await getChat(chatId).catch((err: Error) => {
        if (alive) setError(err.message);
        return null;
      });
      if (!alive || !chat) return;
      setEvents(chat.events);
      // A chat created by the first message loads before its turn has started: never un-busy it here.
      // (A channel keeps nobody waiting: its agents' turns show in the thread instead.)
      setBusy((prev) => !inChannelRef.current && (prev || chat.busy));
      const after = chat.events[chat.events.length - 1]?.seq ?? 0;
      source = new EventSource(`/api/chats/${chatId}/events?after=${after}`);
      source.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as ChatEvent;
        // A reconnect replays from `after`: keep each seq once.
        setEvents((prev) => (prev.length && ev.seq <= prev[prev.length - 1].seq ? prev : [...prev, ev]));
        if (ev.type === "turn_end" || ev.type === "error" || ev.type === "failure") setBusy(false);
      };
    })();
    return () => {
      alive = false;
      source?.close();
    };
  }, [chatId]);

  const blocks = useMemo(() => toBlocks(events), [events]);
  const atWork = useMemo(() => (inChannel ? working(events) : []), [inChannel, events]);
  /** Something is being worked on: the one agent's turn, or any agent's in a channel. */
  const active = inChannel ? atWork.length > 0 : busy;
  const agentOf = (slug: string) => agents.find((a) => a.slug === slug);
  const authorLabel = (from?: Author) =>
    from?.kind === "agent" ? `${agentOf(from.slug)?.emoji ?? "🤖"} ${agentOf(from.slug)?.name ?? from.slug}` : from?.name;

  // Follow the stream while the reader sits at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  /** Put a message into the chat, creating it on the first one. Throws when the server refuses. */
  const post = useCallback(
    async (text: string) => {
      setError("");
      if (!inChannel) setBusy(true);
      pinned.current = true;
      try {
        let id = chatId;
        const created = !id;
        if (!id) {
          id = (await (target === GENERAL ? createGeneralChat(harness) : createAgentChat(target))).id;
          stored.set(chatKey, id);
          if (target === GENERAL) stored.set(HARNESS_KEY, harness);
          setChatId(id);
        }
        await sendMessage(id, text, inChannel ? me.trim() || undefined : undefined);
        // The first message names the session: the picker should show it.
        if (created) void refreshChats();
      } catch (err) {
        setBusy(false);
        throw err;
      }
    },
    [chatId, harness, chatKey, target, refreshChats, inChannel, me]
  );

  // A message from elsewhere on the page goes out as if typed here. While the
  // agent works it waits in the composer instead, for the user to send.
  const handled = useRef(0);
  useEffect(() => {
    if (!compose || !ready || handled.current === compose.n) return;
    handled.current = compose.n;
    if (busy) {
      setDraft(compose.text);
      composer.current?.focus();
      return;
    }
    post(compose.text).catch((err: Error) => {
      setError(err.message);
      setDraft(compose.text);
    });
  }, [compose, ready, busy, post]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    try {
      await post(text);
    } catch (err) {
      setError((err as Error).message);
      setDraft(text);
    }
  }, [draft, busy, post]);

  // A run started with Run! reports here once it ended: one message, and the
  // agent answers with the result. It waits for a free turn; a run that never
  // showed up (removed, another output folder) is let go after a minute.
  const reporting = useRef(false);
  useEffect(() => {
    if (!ready || !runs || busy || reporting.current) return;
    for (const ui of pending) {
      const run = runs.find((r) => r.id === ui.id);
      if (!run && Date.now() - ui.at > 60_000) onSettled(ui.id);
    }
    const ui = pending.find((p) => runEnded(runs.find((r) => r.id === p.id)));
    const run = ui && runs.find((r) => r.id === ui.id);
    if (!ui || !run) return;
    reporting.current = true;
    post(runReport(ui, run, outputDir))
      .then(() => onSettled(ui.id))
      .catch((err: Error) => setError(`Could not report the run of ${ui.workflow}: ${err.message}`))
      .finally(() => {
        reporting.current = false;
      });
  }, [ready, runs, busy, pending, outputDir, post, onSettled]);

  // Wide screens have room for a third column: who can be talked to stands
  // open beside the chat, and the title stops being a dropdown.
  const wide = useMedia("(min-width: 1320px)");
  const targetProps = {
    agents,
    channels: channels ?? [],
    target,
    onPick: pickTarget,
    onEdit: (key: string) => (channelOf(key) ? setEditingChannel(channelOf(key)) : setEditing(key)),
    onNew: () => setEditing(null),
    onNewChannel: () => setEditingChannel(null),
  };

  return (
    <>
      {wide && <TargetSidebar {...targetProps} />}
      <section className="panel chat" aria-label="Conversation">
        <header className="panel-head">
          <TargetPicker {...targetProps} fixed={wide} />
          {!inChannel && (
            <SessionPicker
              sessions={chats.filter((c) => isSessionOf(c, target))}
              current={chatId}
              onOpen={refreshChats}
              onPick={(id) => {
                stored.set(chatKey, id);
                openSession(id);
              }}
              onNew={() => {
                stored.set(chatKey, "new");
                openSession(null);
              }}
            />
          )}
        </header>

        {editingChannel !== undefined && (
          <ChannelModal
            channel={channels?.find((c) => c.slug === editingChannel)}
            agents={agents}
            onClose={() => setEditingChannel(undefined)}
            onSaved={(saved, created) => {
              setEditingChannel(undefined);
              // Known before it becomes the target, or the target would be given up as gone.
              setChannels((prev) => [...(prev ?? []).filter((c) => c.slug !== saved.slug), saved].sort((a, b) => a.name.localeCompare(b.name)));
              if (created) pickTarget(channelTarget(saved.slug));
            }}
          />
        )}

        {editing !== undefined && (
          <AgentModal
            slug={editing ?? undefined}
            onClose={() => setEditing(undefined)}
            onSaved={(agent, created) => {
              setEditing(undefined);
              // The list first, so the new agent exists when it becomes the target.
              void refreshAgents().then(() => created && pickTarget(agent.slug));
            }}
          />
        )}

        <div
          className="thread"
          ref={thread}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {ready && blocks.length === 0 && pending.length === 0 && (
            <div className="thread-empty">
              <p>
                {channel
                  ? channel.purpose || "A shared conversation."
                  : agents.find((a) => a.slug === target)?.description || "Ask anything about this workspace, or have something done in it."}
              </p>
              {channel && (
                <p>
                  {channel.members.length
                    ? `Mention who should answer: ${channel.members.map((m) => `@${m}`).join(" ")}`
                    : "No agents are in this channel yet."}
                </p>
              )}
              {!chatId && target === GENERAL && (
                <label className="harness">
                  answered by{" "}
                  <select value={harness} onChange={(e) => setHarness(e.target.value as Harness)}>
                    {HARNESSES.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {blocks.map((b) => {
            switch (b.kind) {
              case "user":
                return (
                  <div key={b.key} className="msg msg-user">
                    {b.from && <span className="msg-author">{authorLabel(b.from)}</span>}
                    {b.text}
                  </div>
                );
              case "run":
                return (
                  <div key={b.key} className="run-card">
                    <div className="run-card-title">Workflow run</div>
                    <div className="run-card-line">{b.title}</div>
                    {b.request && <div className="run-card-request">{b.request}</div>}
                    {b.runId && (
                      <button className="run-card-open" onClick={() => onOpenRun(b.runId!)}>
                        details
                      </button>
                    )}
                  </div>
                );
              case "agent":
                return (
                  <div key={b.key} className="msg msg-agent">
                    {b.from && <span className="msg-author">{authorLabel(b.from)}</span>}
                    <Markdown text={b.text} />
                  </div>
                );
              case "activity":
                return (
                  <div key={b.key} className={`activity${b.open && active ? " live" : ""}`}>
                    <span className="activity-dot" aria-hidden />
                    {b.open && active ? b.last : `${b.count} ${b.count === 1 ? "step" : "steps"} · ${b.last}`}
                  </div>
                );
              case "permission":
                return (
                  <div key={b.key} className="card">
                    <div className="card-title">Permission needed</div>
                    <div className="card-body">{b.title}</div>
                    {b.answer === undefined ? (
                      <div className="card-actions">
                        {b.options.map((o) => (
                          <button
                            key={o.optionId}
                            className={o.kind?.startsWith("reject") ? "quiet" : "primary"}
                            onClick={() => chatId && answerPermission(chatId, b.requestId, o.optionId).catch((err: Error) => setError(err.message))}
                          >
                            {o.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="card-answer">{b.answer ?? "declined"}</div>
                    )}
                  </div>
                );
              case "question":
                return (
                  <div key={b.key} className="card">
                    <div className="card-title">The agent has a question</div>
                    <div className="card-body">{b.message}</div>
                    {b.resolved ? (
                      <div className="card-answer">answered</div>
                    ) : (
                      <div className="card-actions">
                        <span className="card-hint">Answer forms live in the full inspector for now.</span>
                        <button
                          className="quiet"
                          onClick={() => chatId && declineElicitation(chatId, b.requestId).catch((err: Error) => setError(err.message))}
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </div>
                );
              case "error":
                return (
                  <div key={b.key} className="msg msg-error" role="alert">
                    {b.text}
                  </div>
                );
            }
          })}
          {pending.map((ui) => {
            const line = runLine(runs?.find((r) => r.id === ui.id));
            return (
              <div key={ui.id} className={`activity run-live tone-${line.tone}${line.tone === "live" ? " live" : ""}`}>
                <span className="activity-dot" aria-hidden />
                Workflow {ui.workflow} · {line.text}
              </div>
            );
          })}
          {busy && ["user", "run"].includes(blocks[blocks.length - 1]?.kind ?? "") && (
            <div className="activity live">
              <span className="activity-dot" aria-hidden />
              thinking…
            </div>
          )}
          {atWork.map((slug) => (
            <div key={slug} className="activity live">
              <span className="activity-dot" aria-hidden />
              {agentOf(slug)?.name ?? slug} is working…
            </div>
          ))}
        </div>

        {error && (
          <div className="panel-error" role="alert">
            {error}
          </div>
        )}

        {inChannel && (
          <label className="posting-as">
            posting as
            <input
              value={me}
              placeholder="your name"
              onChange={(e) => {
                setMe(e.target.value);
                stored.set(ME_KEY, e.target.value.trim());
              }}
            />
          </label>
        )}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            value={draft}
            rows={1}
            placeholder={inChannel ? "Message… @mention who should answer" : "Message…"}
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {active && (
            <button type="button" className="quiet" onClick={() => chatId && cancelChat(chatId).catch((err: Error) => setError(err.message))}>
              {inChannel ? "Stop all" : "Stop"}
            </button>
          )}
          {/* One agent is waited for; in a channel people are never kept waiting. */}
          {(!busy || inChannel) && (
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Send
            </button>
          )}
        </form>
      </section>
    </>
  );
}
