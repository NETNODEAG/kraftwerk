import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Agent, Author, Channel, ChatAgentId, ChatMeta, ChatScope, SkillInfo, StoredChatEvent } from "./types";
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
  scope: { kind: string; runId?: string; bundle?: string; slug?: string }
): Promise<void> {
  const res = await fetch("/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, scope }),
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

export function NewChat() {
  const [agent, setAgent] = useState<ChatAgentId>("claude");
  const [kraftwerkAware, setKraftwerkAware] = useState(true);
  const [creating, setCreating] = useState(false);

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
    </div>
  );
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
  const features = useFeatures();

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
            <Link href={`/channels/${encodeURIComponent(channel.slug)}/edit`} className="open-raw" title="members, purpose, responder">
              <Icon name="tune" className="ms-sm" /> members
            </Link>
          </div>
          <div className="channel-members">
            {channel.purpose && <span className="channel-purpose">{channel.purpose}</span>}
            {channel.members.map((m) => {
              const a = agentMap.get(m);
              const on = working.includes(m);
              return (
                <Link key={m} href={`/agents/${encodeURIComponent(m)}/info`} className={`member-chip ${on ? "working" : ""}`} title={a?.description}>
                  <span className="agent-avatar sm">
                    <span aria-hidden>{a?.emoji ?? "🤖"}</span>
                    <span className={`lamp ${on ? "running" : "idle"}`} />
                  </span>
                  <span className="member-name">{a?.name ?? m}</span>
                  <span className="member-handle">@{m}</span>
                  {channel.responder === m && <span className="chip">responder</span>}
                </Link>
              );
            })}
          </div>
          <Thread id={id} events={events} busy={busy} channel={channel} agentMap={agentMap} working={working} />
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
        {!meta.vibeable && features.vibeables && (
          <button className="ws-btn vibeable-open" onClick={() => setPicker(true)} title="Build a small app live: a preview pane next to this chat" disabled={busy}>
            <Icon name="web" className="ms-sm" /> vibeable
          </button>
        )}
        <span className="chip agent">{meta.agent}</span>
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
      <Composer id={id} busy={busy} scope={meta.scope} />
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
  | { kind: "user"; text: string; key: string; from?: Author }
  | { kind: "agent"; text: string; key: string; from?: Author }
  | { kind: "thought"; text: string; key: string; from?: Author }
  | { kind: "tool"; callId: string; title: string; toolKind?: string; status?: string; key: string; from?: Author }
  | {
      kind: "permission";
      requestId: string;
      title: string;
      options: Array<{ optionId: string; name: string; kind?: string }>;
      resolved: string | null | undefined; // undefined = pending
      key: string;
      from?: Author;
    }
  | { kind: "error"; text: string; key: string; from?: Author };

const sameAuthor = (a?: Author, b?: Author): boolean =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && (a.kind === "human" ? a.name === (b as { name: string }).name : a.slug === (b as { slug: string }).slug));

function toBlocks(events: StoredChatEvent[]): Block[] {
  const blocks: Block[] = [];
  const toolIndex = new Map<string, number>();
  const permIndex = new Map<string, number>();
  for (const ev of events) {
    const last = blocks[blocks.length - 1];
    switch (ev.type) {
      case "user_message":
        blocks.push({ kind: "user", text: ev.text, key: `e${ev.seq}`, from: ev.from });
        break;
      case "text":
        if (last?.kind === "agent" && sameAuthor(last.from, ev.from)) last.text += ev.text;
        else blocks.push({ kind: "agent", text: ev.text, key: `e${ev.seq}`, from: ev.from });
        break;
      case "thought":
        if (last?.kind === "thought" && sameAuthor(last.from, ev.from)) last.text += ev.text;
        else blocks.push({ kind: "thought", text: ev.text, key: `e${ev.seq}`, from: ev.from });
        break;
      case "tool_call":
        toolIndex.set(ev.callId, blocks.length);
        blocks.push({
          kind: "tool",
          callId: ev.callId,
          title: ev.title,
          toolKind: ev.kind,
          status: ev.status,
          key: `e${ev.seq}`,
          from: ev.from,
        });
        break;
      case "tool_update": {
        const i = toolIndex.get(ev.callId);
        if (i != null) {
          const b = blocks[i] as Extract<Block, { kind: "tool" }>;
          if (ev.title) b.title = ev.title;
          if (ev.status) b.status = ev.status;
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
      // turn_start / turn_end render nothing.
    }
  }
  return blocks;
}

function Thread({
  id,
  events,
  busy,
  channel,
  agentMap,
  working,
}: {
  id: string;
  events: StoredChatEvent[];
  busy: boolean;
  channel?: Channel;
  agentMap?: Map<string, Agent>;
  working?: string[];
}) {
  const expert = useExpertMode();
  const blocks = useMemo(() => {
    const all = toBlocks(events);
    // Simple mode: no tool activity, no thinking — the conversation plus
    // the "working…" indicator below is the whole story.
    return expert ? all : all.filter((b) => b.kind !== "tool" && b.kind !== "thought");
  }, [events, expert]);
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
      return <div className="msg user">{b.text}</div>;
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
        <div className={`tool-card ${b.status ?? ""}`}>
          <span
            className={`lamp ${
              b.status === "completed" ? "ok" : b.status === "failed" ? "failed" : "running"
            }`}
          />
          {b.toolKind && <span className="chip tool-kind">{b.toolKind}</span>}
          <span className="tool-title">{b.title}</span>
        </div>
      );
    case "permission":
      return <PermissionCard b={b} chatId={chatId} />;
    case "error":
      return <div className="msg error"><Icon name="error" className="ms-sm" /> {b.text}</div>;
  }
}

function PermissionCard({
  b,
  chatId,
}: {
  b: Extract<Block, { kind: "permission" }>;
  chatId: string;
}) {
  const [sending, setSending] = useState(false);
  const pending = b.resolved === undefined;

  async function answer(optionId: string | null) {
    setSending(true);
    await fetch(`/api/chats/${chatId}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: b.requestId, optionId }),
    }).catch(() => {});
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
}: {
  id: string;
  busy: boolean;
  scope?: ChatScope;
  channel?: Channel;
  agentMap?: Map<string, Agent>;
}) {
  const [text, setText] = useState("");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [me, setMe] = useState(myName);
  const [editingMe, setEditingMe] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Channels never block the humans: an agent that is busy is woken again
  // when its turn ends. Ordinary chats take one message per turn.
  const locked = busy && !channel;

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
  // Channels: "@partial" at the caret offers the members.
  const caret = taRef.current?.selectionStart ?? text.length;
  const atMatch = channel && !dismissed ? /(^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret)) : null;
  const mentionMatches =
    atMatch && channel
      ? channel.members.filter((m) => m.startsWith(atMatch[2].toLowerCase()) || (agentMap?.get(m)?.name ?? "").toLowerCase().startsWith(atMatch[2].toLowerCase()))
      : [];
  const matches: Array<{ id: string; label: string; hint?: string; src?: string; pick: () => void }> = [
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
  const menuOpen = matches.length > 0;
  const selIdx = Math.min(sel, matches.length - 1);

  async function send() {
    const t = text.trim();
    if (!t || locked) return;
    setText("");
    await fetch(`/api/chats/${id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t, ...(channel ? { from: me || "you" } : {}) }),
    }).catch(() => {});
  }

  return (
    <div className="composer">
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
      <textarea
        ref={taRef}
        value={text}
        placeholder={
          locked
            ? "agent is working…"
            : channel
              ? "message the channel  ·  @ to mention an agent, / for skills, Enter to send"
              : "message  ·  Enter to send, Shift+Enter for newline, / for skills"
        }
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        onChange={(e) => {
          setText(e.target.value);
          setSel(0);
          setDismissed(false);
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
        <button className="run-btn" disabled={!text.trim()} onClick={send}>
          <Icon name="send" className="ms-sm" /> send
        </button>
      )}
    </div>
  );
}
