import { useCallback, useEffect, useState } from "react";
import type { Agent } from "../types";
import { NewChat, createChatAndOpen } from "../chat";
import { api } from "../api";
import { navigate, useExpertMode } from "../shared";
import { NewTabButton, SessionsPane, type Session } from "../sessions";
import { Button, EmptyState, Page, Panel, Title } from "../ui";

/**
 * Landings and session lists: where a bare agent or chats URL goes, the
 * fresh pane of an agent, and the session tabs above the chat.
 */

/**
 * A bare #/agents/<slug> URL jumps straight into the agent's most recent
 * session; with no sessions yet it offers a first one (the profile is the
 * pencil on the sign).
 */
export function AgentLanding({ slug, name }: { slug: string; name?: string }) {
  const [noSessions, setNoSessions] = useState(false);
  useEffect(() => {
    let alive = true;
    setNoSessions(false);
    api
      .call("chats.list")
      .then((d) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind === "agent" && c.scope.slug === slug);
        if (latest) {
          navigate(`/agents/${encodeURIComponent(slug)}/chat/${latest.id}`, { replace: true });
        } else setNoSessions(true);
      })
      .catch(() => alive && setNoSessions(true));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!noSessions) return <EmptyState>loading…</EmptyState>;
  return <NewAgentSession slug={slug} name={name} />;
}

/** The fresh pane of an agent: what shows when no session is open. */
export function NewAgentSession({ slug, name }: { slug: string; name?: string }) {
  const [creating, setCreating] = useState(false);
  return (
    <Page width="narrow">
      <Title>new session with {name ?? slug}</Title>
      <Panel>
        <div className="p-4">
          <button
            type="button"
            className="flex w-full cursor-pointer flex-col gap-0.5 rounded-card border border-transparent bg-accent-soft px-3.5 py-3 text-left text-on-accent-soft transition-colors hover:brightness-[0.98] disabled:cursor-default disabled:opacity-60"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen("claude", { kind: "agent", slug });
              setCreating(false);
            }}
          >
            <b className="text-base font-medium">{creating ? "starting…" : "start chat"}</b>
            <span className="text-xs">on the agent's harness, with its role, knowledge and skills</span>
          </button>
        </div>
      </Panel>
    </Page>
  );
}

/**
 * A bare #/agents/chats (the "Ralv" entry) opens the most recent
 * general chat, like an agent's entry opens its latest session; with none
 * yet it shows the new-chat pane, which otherwise lives at /chats/new.
 */
export function GeneralChatsLanding() {
  const [none, setNone] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .call("chats.list")
      .then((d) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind !== "agent" && c.scope.kind !== "channel" && c.scope.kind !== "project");
        if (latest) navigate(`/agents/chats/${latest.id}`, { replace: true });
        else setNone(true);
      })
      .catch(() => alive && setNone(true));
    return () => {
      alive = false;
    };
  }, []);
  if (!none) return <EmptyState>loading…</EmptyState>;
  return <NewChat />;
}

/* ---------- sessions: tabs above the chat, the list on request ---------- */

export function AgentSessions({ slug, chatId }: { slug: string; chatId?: string }) {
  const [creating, setCreating] = useState(false);
  const filter = useCallback((chats: Session[]) => chats.filter((c) => c.scope.kind === "agent" && c.scope.slug === slug), [slug]);
  const hrefOf = useCallback((c: Session) => `/agents/${encodeURIComponent(slug)}/chat/${c.id}`, [slug]);
  return (
    <SessionsPane
      storeKey={`agent:${slug}`}
      label="chats"
      fallbackTitle="new chat"
      chatId={chatId}
      filter={filter}
      hrefOf={hrefOf}
      closeHref={`/agents/${encodeURIComponent(slug)}/chat/new`}
      actions={
        <NewTabButton
          busy={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "agent", slug: slug });
            setCreating(false);
          }}
        />
      }
    />
  );
}

// Chats that belong to no agent, channel or project — Ralv's.
const generalChats = (chats: Session[]): Session[] => chats.filter((c) => c.scope.kind !== "agent" && c.scope.kind !== "channel" && c.scope.kind !== "project");
const generalHref = (c: Session): string => `/agents/chats/${c.id}`;

export function GeneralSessions({ chatId }: { chatId?: string }) {
  return (
    <SessionsPane
      storeKey="general"
      label="chats"
      fallbackTitle="new chat"
      chatId={chatId}
      filter={generalChats}
      hrefOf={generalHref}
      closeHref="/agents/chats/new"
      subOf={(c) => (
        <>
          {c.agent}
          {c.scope.kind === "run"
            ? ` · ${c.scope.runId}`
            : c.scope.kind === "kraftwerk"
              ? " · kraftwerk"
              : c.scope.kind === "knowledge"
                ? ` · knowledge${c.scope.bundle ? `:${c.scope.bundle}` : ""}`
                : ""}
        </>
      )}
      actions={
        <NewTabButton href="/agents/chats/new" />
      }
    />
  );
}

/* ---------- home ---------- */

/**
 * #/agents with agents in the workspace: land on the most recent agent
 * session (like #/channels lands on the latest channel); an agent that has
 * never been talked to lands on its profile.
 */
export function AgentsLanding({ agents }: { agents: Agent[] }) {
  useEffect(() => {
    let alive = true;
    const fallback = () => navigate(`/agents/${encodeURIComponent(agents[0].slug)}`, { replace: true });
    api
      .call("chats.list")
      .then((d) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — the first agent session wins.
        const slugs = new Set(agents.map((a) => a.slug));
        const latest = d.chats.find((c) => c.scope.kind === "agent" && slugs.has(c.scope.slug));
        if (latest && latest.scope.kind === "agent") {
          navigate(`/agents/${encodeURIComponent(latest.scope.slug)}/chat/${latest.id}`, { replace: true });
        } else fallback();
      })
      .catch(() => alive && fallback());
    return () => {
      alive = false;
    };
  }, [agents.map((a) => a.slug).join(",")]);
  return <EmptyState>loading…</EmptyState>;
}

/** No agents yet: nothing to explain, one thing to do (which needs expert mode). */
export function AgentsHome() {
  const expert = useExpertMode();
  return (
    <div className="empty-action flex justify-center py-16 text-center text-sm text-fg-2">
      {expert ? (
        // run-btn: the hook e2e/agents.spec.ts finds the one action by.
        <Button variant="primary" icon="add" onClick={() => navigate("/agents/new")}>
          create your first agent
        </Button>
      ) : (
        <span>Creating agents needs expert mode — flip the switch in the top bar.</span>
      )}
    </div>
  );
}
