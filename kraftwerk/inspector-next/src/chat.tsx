import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  answerPermission,
  cancelChat,
  createGeneralChat,
  declineElicitation,
  getChat,
  listChats,
  sendMessage,
  inspectorUrl,
  type ChatEvent,
  type Harness,
  type RunListItem,
} from "./api";
import { RUN_MARK, runEnded, runLine, runReport, type UiRun } from "./runs";

const HARNESSES: Harness[] = ["claude", "codex", "pi"];
const HARNESS_KEY = "kw-next-harness";

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
  | { kind: "user" | "agent" | "error"; key: string; text: string }
  /** The report of a run started with Run! (runReport): a card, not the prose the agent was sent. */
  | { kind: "run"; key: string; title: string; request?: string; runId?: string }
  /** A stretch of tool calls, shown as one line: what the agent is doing, not how. */
  | { kind: "activity"; key: string; count: number; last: string; open: boolean }
  | { kind: "permission"; key: string; requestId: string; title: string; options: { optionId: string; name: string; kind?: string }[]; answer?: string | null }
  | { kind: "question"; key: string; requestId: string; message: string; resolved: boolean };

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
        } else blocks.push({ kind: "user", key, text: ev.text });
        break;
      case "text":
        if (ev.subagent) break;
        if (last?.kind === "agent") last.text += ev.text;
        else blocks.push({ kind: "agent", key, text: ev.text });
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

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true })), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * One general chat with the workspace. The chat is created with the first
 * message; afterwards the thread follows its SSE stream. `workspaceKey`
 * keeps the remembered chat apart per instance (in dev one origin serves
 * several of them).
 */
export function Chat({ workspaceKey, runs, outputDir, pending, compose, onSettled }: {
  workspaceKey: string;
  /** null until the first poll answered. */
  runs: RunListItem[] | null;
  outputDir: string;
  /** Runs started with Run! whose result this chat still owes the user. */
  pending: UiRun[];
  /** A message drafted elsewhere on the page (a workflow's edit button); `n` makes a repeat count. */
  compose: { text: string; n: number } | null;
  onSettled: (runId: string) => void;
}) {
  const chatKey = `kw-next-chat:${workspaceKey}`;
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

  useEffect(() => {
    if (!compose) return;
    setDraft(compose.text);
    const el = composer.current;
    el?.focus();
    // After React wrote the value: the caret belongs behind the drafted words.
    requestAnimationFrame(() => el?.setSelectionRange(compose.text.length, compose.text.length));
  }, [compose]);

  // Pick up the remembered chat, else the most recent general one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const remembered = stored.get(chatKey);
      let id = remembered && (await getChat(remembered).catch(() => null)) ? remembered : "";
      if (!id) id = (await listChats().catch(() => [])).find((c) => c.scope.kind === "general")?.id ?? "";
      if (!alive) return;
      setChatId(id || null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [chatKey]);

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
      setBusy((prev) => prev || chat.busy);
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

  // Follow the stream while the reader sits at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  /** Put a message into the chat, creating it on the first one. Throws when the server refuses. */
  const post = useCallback(
    async (text: string) => {
      setError("");
      setBusy(true);
      pinned.current = true;
      try {
        let id = chatId;
        if (!id) {
          id = (await createGeneralChat(harness)).id;
          stored.set(chatKey, id);
          stored.set(HARNESS_KEY, harness);
          setChatId(id);
        }
        await sendMessage(id, text);
      } catch (err) {
        setBusy(false);
        throw err;
      }
    },
    [chatId, harness, chatKey]
  );

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

  return (
    <section className="panel chat" aria-label="Chat">
      <header className="panel-head">
        <h2>Chat</h2>
      </header>

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
            <p>Ask anything about this workspace, or have something done in it.</p>
            {!chatId && (
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
                    <a href={inspectorUrl(`/runs/${b.runId}`)} target="_blank" rel="noreferrer">
                      open run
                    </a>
                  )}
                </div>
              );
            case "agent":
              return (
                <div key={b.key} className="msg msg-agent">
                  <Markdown text={b.text} />
                </div>
              );
            case "activity":
              return (
                <div key={b.key} className={`activity${b.open && busy ? " live" : ""}`}>
                  <span className="activity-dot" aria-hidden />
                  {b.open && busy ? b.last : `${b.count} ${b.count === 1 ? "step" : "steps"} · ${b.last}`}
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
        {busy && ["user", "run"].includes(blocks[blocks.length - 1]?.kind ?? "") && <div className="activity live"><span className="activity-dot" aria-hidden />thinking…</div>}
      </div>

      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
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
          placeholder="Message…"
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="quiet" onClick={() => chatId && cancelChat(chatId).catch((err: Error) => setError(err.message))}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}
