/** The chat view: loads a chat, follows its live events, and wires the header, thread and composer for an ordinary chat or a channel. */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Agent, Channel, ChatMeta, StoredChatEvent } from "../types";
import { api, live as socket, useApi } from "../api";
import { Link, navigate, setPageTitle, useExpertMode, useFeatures } from "../shared";
import { VIBE_SLOT_ID, VibeOffNote, VibePane, announceVibeable } from "../vibeables";
import { AddCoworkerDialog } from "../channels";
import { StripEnd } from "../sessions";
import { Button, cn, Dot, EmptyState, Eyebrow, IconButton, Tag, Title } from "../ui";
import { agentActivity, liveState, mainSpeaker, SpeakerContext, stopAgent } from "./helpers";
import { Thread } from "./thread";
import { Composer } from "./composer";
import { AgentStatus } from "./agent-status";

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
  // Renamed anywhere (its tab, another device): the pushed chat list carries the new title.
  const listedTitle = useApi("chats.list", {})?.chats.find((c) => c.id === id)?.title;
  useEffect(() => {
    if (listedTitle !== undefined) setMeta((m) => (m && m.title !== listedTitle ? { ...m, title: listedTitle } : m));
  }, [listedTitle]);
  const [events, setEvents] = useState<StoredChatEvent[]>([]);
  const [gone, setGone] = useState(false);
  const [coworker, setCoworker] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkNote, setForkNote] = useState<string | null>(null);
  // Channels: look at one agent's own session (its stream alone, tools included).
  const [focus, setFocus] = useState<string | null>(null);
  const features = useFeatures();
  const expert = useExpertMode();
  const allAgents = useApi("agents.list", channel ? null : {}, { interval: 30_000 })?.agents ?? [];
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
    let stop: (() => void) | undefined;
    api
      .call("chats.get", { id })
      .then((d) => {
        if (!alive) return;
        setMeta(d.meta);
        setEvents(d.events);
        const last = d.events[d.events.length - 1]?.seq ?? 0;
        stop = socket.subscribe(`chat.${id}`, { after: last }, (data) => {
          const ev = data as StoredChatEvent;
          setEvents((prev) =>
            prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev]
          );
        });
      })
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
      stop?.();
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

  // The chat names itself in its tab, and the tab's dot says whether it works or waits: no header of
  // its own. "add coworker" sits at the strip's right end; expert detail keeps a quiet line here.
  const canCoworker = (meta.scope.kind === "agent" && !meta.scope.routine) || meta.scope.kind === "project";
  const signedOut = live.auth?.kind === "none";
  return (
    <>
    <div className="chat-thread flex min-h-0 w-full flex-1 animate-rise flex-col">
      {canCoworker && (
        <StripEnd>
          <IconButton
            size="sm"
            icon="group_add"
            label="add coworker"
            title={meta.scope.kind === "project" ? "add coworker: turn this chat into a channel of the project and invite agents" : "add coworker: turn this chat into a channel and invite more agents"}
            onClick={() => setCoworker(true)}
            disabled={busy}
          />
        </StripEnd>
      )}
      {(expert || signedOut) && (
      <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 pb-1.5">
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
              const r = await api.request("chats.fork", { id });
              setForking(false);
              if (!r.ok || !r.data?.id) return alert(r.error ?? `fork failed (${r.status})`);
              const body = r.data;
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
      )}
      {meta.vibeable && !features.vibeables && <VibeOffNote chatId={id} slug={meta.vibeable} onClosed={setMeta} />}
      <SpeakerContext.Provider value={() => mainSpeaker(meta.scope, allAgents, agentName)}>
        <Thread id={id} events={events} busy={busy} />
        <Composer id={id} busy={busy} scope={meta.scope} commands={live.commands} canSteer={meta.agent !== "pi"} account={live.auth && live.auth.kind !== "none" ? live.auth.email ?? live.auth.label : undefined} />
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
