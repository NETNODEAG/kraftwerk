import { useEffect } from "react";
import type { Agent } from "../types";
import { SessionHome, createSession, type HomeChat } from "../session-home";
import { api, useApi } from "../api";
import { navigate, useExpertMode } from "../shared";
import type { Session } from "../sessions";
import { Button, EmptyState } from "../ui";

/**
 * Landings: the overviews of an agent and of Ralv (`SessionHome`), and
 * where a bare #/agents goes.
 */

/**
 * A bare #/agents/<slug> (and /chat/new): the agent's overview, like a
 * project's and Ralv's — a composer that starts a session with the agent (or,
 * from the picker, with another agent, which opens in that agent's place) and
 * the agent's recent sessions. An open session is named next to the agent in
 * the title row; there are no tabs.
 */
export function AgentHome({ slug }: { slug: string }) {
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const chats = useApi("chats.list", {});
  const projects = useApi("projects.list", {}, { interval: 60_000 });
  const projectTitle = (p: string) => projects?.projects.find((x) => x.slug === p)?.title ?? p;
  const a = agents?.agents.find((x) => x.slug === slug);
  const name = a?.name ?? slug;
  const href = (agent: string, id: string) => `/agents/${encodeURIComponent(agent)}/chat/${id}`;
  return (
    <SessionHome
      key={slug}
      placeholder={`New session with ${name}`}
      byDefault={{ emoji: a?.emoji || "🤖", name, sub: a?.description, hint: `${a?.harness ?? "claude"} · its role, knowledge and skills` }}
      agentHint="opens in that agent's sessions"
      exclude={slug}
      placeOf={(c) => (c.project ? `📁 ${projectTitle(c.project)}` : undefined)}
      sessions={chats ? (chats.chats.filter((c) => c.scope.kind === "agent" && c.scope.slug === slug) as HomeChat[]) : null}
      hrefOf={(c) => href(slug, c.id)}
      create={(agent) => createSession({ agent: "claude", scope: { kind: "agent", slug: agent ?? slug } }, (id) => href(agent ?? slug, id))}
    />
  );
}

/**
 * A bare #/agents/chats (the rail's "Chats", and /agents/chats/new): Ralv's
 * overview, like a project's — a composer that starts a chat with Ralv or
 * with a specific agent (that one opens in the agent's sessions), and the
 * recent chats: Ralv's and every project's, which open in their project. An open chat is named next to "Ralv" in the title row; there
 * are no tabs.
 */
export function RalvHome() {
  const chats = useApi("chats.list", {});
  const projects = useApi("projects.list", {}, { interval: 60_000 });
  const projectTitle = (p: string) => projects?.projects.find((x) => x.slug === p)?.title ?? p;
  return (
    <SessionHome
      placeholder="New chat with Ralv"
      byDefault={{ emoji: "🎩", name: "Ralv", sub: "chief of staff: knows the workspace, advises, launches things", hint: "claude · knows the workspace" }}
      agentHint="opens in the agent's sessions"
      placeOf={(c) => (projectOf(c) ? `📁 ${projectTitle(projectOf(c)!)}` : undefined)}
      sessions={chats ? (allChats(chats.chats) as HomeChat[]) : null}
      hrefOf={allHref}
      create={(agent) =>
        agent
          ? createSession({ agent: "claude", scope: { kind: "agent", slug: agent } }, (id) => `/agents/${encodeURIComponent(agent)}/chat/${id}`)
          : createSession({ agent: "claude", scope: { kind: "kraftwerk" } }, (id) => `/agents/chats/${id}`)
      }
    />
  );
}

// The project a chat is filed under: a project's own session, or an agent's or channel's filed there.
const projectOf = (c: Session): string | undefined => (c.scope.kind === "project" ? c.scope.slug : c.project || undefined);
// The rail's "Chats": Ralv's (no agent, channel or project) and every chat filed under a project.
const allChats = (chats: Session[]): Session[] =>
  chats.filter((c) => projectOf(c) || (c.scope.kind !== "agent" && c.scope.kind !== "channel"));
// A project's chat opens in the project, so its context column and title row become the project's.
const allHref = (c: Session): string => {
  const p = projectOf(c);
  return p ? `/projects/${encodeURIComponent(p)}/chat/${c.id}` : `/agents/chats/${c.id}`;
};


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
