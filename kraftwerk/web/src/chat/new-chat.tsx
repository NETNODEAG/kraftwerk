/** The new-chat pane: pick an agent, start a chat or continue one of the agent's own sessions. */
import { useEffect, useState } from "react";
import type { ChatAgentId } from "../types";
import { api } from "../api";
import { navigate } from "../shared";
import { Button, cn, EmptyState, ListRow, Page, Panel, Title } from "../ui";

const AGENTS: Array<{ id: ChatAgentId; label: string; hint: string }> = [
  { id: "claude", label: "claude", hint: "Claude Code via ACP" },
  { id: "codex", label: "codex", hint: "Codex (ChatGPT) via ACP" },
  { id: "pi", label: "pi", hint: "pi coding agent" },
];

export async function createChatAndOpen(
  agent: ChatAgentId,
  scope: { kind: string; runId?: string; bundle?: string; slug?: string },
  resume?: string
): Promise<void> {
  const r = await api.request("chats.create", { body: { agent, scope, ...(resume ? { resume } : {}) } });
  const meta = r.ok ? r.data : null;
  if (meta?.id) {
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
                  const d = await api.call("agents.sessions", { query: { agent } }).catch(() => ({ sessions: [] }));
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
