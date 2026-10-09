/** The thread: the blocks in order with channel bylines, the waiting line, and how each block renders (messages, activity, plans, files, failures). */
import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { onBrowseClick, withBrowseIcons } from "../context-browser";
import type {
  Agent,
  Author,
  Channel,
  Compaction,
  SessionFailure,
  StoredChatEvent,
} from "../types";
import { api } from "../api";
import { Icon, Link, useExpertMode } from "../shared";
import { Button, cn, Dot, EmptyState, Eyebrow, type DotTone } from "../ui";
import { pendingFrom, useSpeaker } from "./helpers";
import { sameAuthor, toBlocks, type Block } from "./blocks";
import { PermissionCard, QuestionCard } from "./asks";

const ACTIVITY_KINDS = new Set(["tool", "thought", "subagent", "task", "files"]);

export function Thread({
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
                const href = api.url("chats.attachment", { id: chatId, name: a.name });
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
                  api.request("chats.stopTask", { id: chatId, body: { taskId: b.taskId } }).catch(() => {})
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
        await api.request("chats.message", { id: chatId, body: { text: b.retryText } });
      } else {
        const r = await api.request("chats.resetSession", { id: chatId });
        if (!r.ok) setNote(r.error ?? `reset failed (${r.status})`);
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
