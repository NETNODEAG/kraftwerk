import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ChatAgentId, ChatMeta, ChatScope, SkillInfo, StoredChatEvent } from "./types";
import { Link, navigate, usePoll, fmtWhen, useExpertMode } from "./shared";

/**
 * Chat screen: sidebar with all chats plus a thread view. History comes
 * from GET /api/chats/:id; live events stream over SSE. The thread is a
 * pure replay of the event log — text chunks merge into agent messages,
 * tool calls render as activity cards, permission requests as decision
 * cards with buttons.
 */

const AGENTS: Array<{ id: ChatAgentId; label: string; hint: string }> = [
  { id: "claude", label: "claude", hint: "Claude Code via ACP" },
  { id: "codex", label: "codex", hint: "Codex (ChatGPT) via ACP" },
  { id: "pi", label: "pi", hint: "pi coding agent" },
];

export function ChatScreen({ id }: { id?: string }) {
  const data = usePoll<{ chats: Array<ChatMeta & { busy: boolean }> }>("/api/chats", false);
  // Team sessions live on the team screen, not in the general chat list.
  const chats = (data?.chats ?? []).filter((c) => c.scope.kind !== "team");

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">chats</span>
          <span className="spacer" />
          <Link href="/chats" className="open-raw">
            + new
          </Link>
        </div>
        <div className="side-list">
          {chats.map((c) => (
            <Link
              key={c.id}
              href={`/chats/${c.id}`}
              className={`side-row ${c.id === id ? "active" : ""}`}
            >
              <span className={`lamp ${c.busy ? "running" : "pending"}`} />
              <div className="side-row-body">
                <div className="side-row-top">
                  <span className="side-wf">{c.title || "new chat"}</span>
                  <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
                </div>
                <div className="side-row-sub">
                  <span className="side-req">
                    {c.agent}
                    {c.scope.kind === "run"
                      ? ` · ${c.scope.runId}`
                      : c.scope.kind === "kraftwerk"
                        ? " · kraftwerk"
                        : c.scope.kind === "knowledge"
                          ? ` · knowledge${c.scope.bundle ? `:${c.scope.bundle}` : ""}`
                          : ""}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {data && chats.length === 0 && <div className="viewer-note">no chats yet</div>}
        </div>
      </aside>
      <div className="runs-main chat-main">
        {id ? <ChatThread key={id} id={id} /> : <NewChat />}
      </div>
    </div>
  );
}

/* ---------- new chat ---------- */

export async function createChatAndOpen(
  agent: ChatAgentId,
  scope: { kind: string; runId?: string; bundle?: string; member?: string }
): Promise<void> {
  const res = await fetch("/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, scope }),
  });
  const meta = await res.json();
  if (meta.id) {
    navigate(
      meta.scope?.kind === "team"
        ? `/team/${encodeURIComponent(meta.scope.member)}/chat/${meta.id}`
        : `/chats/${meta.id}`
    );
  }
}

function NewChat() {
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

export function ChatThread({ id }: { id: string }) {
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [events, setEvents] = useState<StoredChatEvent[]>([]);
  const [gone, setGone] = useState(false);

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

  const busy = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const t = events[i].type;
      if (t === "user_message") return true;
      if (t === "turn_end" || t === "error") return false;
    }
    return false;
  }, [events]);

  if (gone) return <div className="empty">chat not found</div>;
  if (!meta) return <div className="empty">loading…</div>;

  return (
    <div className="chat-thread">
      <div className="detail-head">
        <span className={`lamp ${busy ? "running" : "ok"}`} />
        <h1>{meta.title || "new chat"}</h1>
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
        {meta.scope.kind === "team" && (
          <Link href={`/team/${encodeURIComponent(meta.scope.member)}`} className="chip">
            team:{meta.scope.member}
          </Link>
        )}
        <span className="rid" title={meta.cwd}>
          {meta.cwd}
        </span>
      </div>
      <Thread id={id} events={events} busy={busy} />
      <Composer id={id} busy={busy} scope={meta.scope} />
    </div>
  );
}

/** Rendered thread block. */
type Block =
  | { kind: "user"; text: string; key: string }
  | { kind: "agent"; text: string; key: string }
  | { kind: "thought"; text: string; key: string }
  | { kind: "tool"; callId: string; title: string; toolKind?: string; status?: string; key: string }
  | {
      kind: "permission";
      requestId: string;
      title: string;
      options: Array<{ optionId: string; name: string; kind?: string }>;
      resolved: string | null | undefined; // undefined = pending
      key: string;
    }
  | { kind: "error"; text: string; key: string };

function toBlocks(events: StoredChatEvent[]): Block[] {
  const blocks: Block[] = [];
  const toolIndex = new Map<string, number>();
  const permIndex = new Map<string, number>();
  for (const ev of events) {
    const last = blocks[blocks.length - 1];
    switch (ev.type) {
      case "user_message":
        blocks.push({ kind: "user", text: ev.text, key: `e${ev.seq}` });
        break;
      case "text":
        if (last?.kind === "agent") last.text += ev.text;
        else blocks.push({ kind: "agent", text: ev.text, key: `e${ev.seq}` });
        break;
      case "thought":
        if (last?.kind === "thought") last.text += ev.text;
        else blocks.push({ kind: "thought", text: ev.text, key: `e${ev.seq}` });
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
        });
        break;
      case "permission_resolved": {
        const i = permIndex.get(ev.requestId);
        if (i != null) (blocks[i] as Extract<Block, { kind: "permission" }>).resolved = ev.optionId;
        break;
      }
      case "error":
        blocks.push({ kind: "error", text: ev.message, key: `e${ev.seq}` });
        break;
      // turn_end renders nothing.
    }
  }
  return blocks;
}

function Thread({ id, events, busy }: { id: string; events: StoredChatEvent[]; busy: boolean }) {
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
        <div className="empty">say something — the agent starts on your first message</div>
      )}
      {blocks.map((b) => (
        <BlockView key={b.key} b={b} chatId={id} />
      ))}
      {busy && (
        <div className="chat-working">
          <span className="lamp running" /> working…
        </div>
      )}
    </div>
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
      return <div className="msg error">✕ {b.text}</div>;
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

function Composer({ id, busy, scope }: { id: string; busy: boolean; scope?: ChatScope }) {
  const [text, setText] = useState("");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Skills the /-menu offers: all discovered ones, narrowed by the team
  // member's allowlist when this is a team session (mirrors the server).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetch("/api/skills").then((r) => r.json());
        let list: SkillInfo[] = d.skills ?? [];
        if (scope?.kind === "team") {
          const m = await fetch(`/api/team/${encodeURIComponent(scope.member)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (m && Array.isArray(m.skills)) {
            const allowed = new Set(m.skills.map((n: string) => n.toLowerCase()));
            list = list.filter((s) => allowed.has(s.name.toLowerCase()));
          }
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
  const matches =
    slashQuery !== undefined && !dismissed
      ? skills.filter((s) => s.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
      : [];
  const menuOpen = matches.length > 0;
  const selIdx = Math.min(sel, matches.length - 1);

  function pick(skill: SkillInfo) {
    setText(`/${skill.name} `);
    setSel(0);
  }

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    await fetch(`/api/chats/${id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t }),
    }).catch(() => {});
  }

  return (
    <div className="composer">
      {menuOpen && (
        <div className="skill-menu">
          {matches.map((s, i) => (
            <button
              key={s.name}
              className={i === selIdx ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <b>/{s.name}</b>
              {s.description && <span> — {s.description}</span>}
              <span className="skill-src">{s.source}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        placeholder={
          busy
            ? "agent is working…"
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
              return pick(matches[selIdx]);
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
      {busy ? (
        <button
          className="stop-btn"
          onClick={() => fetch(`/api/chats/${id}/cancel`, { method: "POST" }).catch(() => {})}
        >
          ■ stop
        </button>
      ) : (
        <button className="run-btn" disabled={!text.trim()} onClick={send}>
          send
        </button>
      )}
    </div>
  );
}
