import { useEffect, useState } from "react";
import type { Agent, ChatAgentId, ConfigOption } from "../types";
import { SessionHome, createSession, type HomeChat } from "../session-home";
import { api, failure, useApi } from "../api";
import { navigate } from "../shared";
import type { Session } from "../sessions";
import { Button, EmptyState, Select } from "../ui";

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
      pickProject="filed"
      // Filed under a project, the session opens there, with the project's context.
      create={(agent, project) =>
        createSession({ agent: "claude", scope: { kind: "agent", slug: agent ?? slug }, ...(project ? { project: project.slug } : {}) }, (id) =>
          project ? `/projects/${encodeURIComponent(project.slug)}/chat/${id}` : href(agent ?? slug, id),
        )
      }
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
  const start = useStartChoice();
  const chats = useApi("chats.list", {});
  const projects = useApi("projects.list", {}, { interval: 60_000 });
  const projectTitle = (p: string) => projects?.projects.find((x) => x.slug === p)?.title ?? p;
  return (
    <SessionHome
      placeholder="New chat with Ralv"
      byDefault={{ emoji: "🎩", name: "Ralv", sub: "chief of staff: knows the workspace, advises, launches things", hint: "knows the workspace" }}
      defaultControls={<StartPicker {...start} />}
      agentHint="opens in the agent's sessions"
      placeOf={(c) => (projectOf(c) ? `📁 ${projectTitle(projectOf(c)!)}` : undefined)}
      sessions={chats ? (allChats(chats.chats) as HomeChat[]) : null}
      hrefOf={allHref}
      pickProject="assistant"
      // In a project: its assistant, or the agent picked with the session filed there; either opens in the project.
      create={(agent, project) => {
        const inProject = (id: string) => `/projects/${encodeURIComponent(project!.slug)}/chat/${id}`;
        if (agent)
          return createSession(
            { agent: "claude", scope: { kind: "agent", slug: agent }, ...(project ? { project: project.slug } : {}) },
            project ? inProject : (id) => `/agents/${encodeURIComponent(agent)}/chat/${id}`,
          );
        if (project) return createSession({ agent: project.harness, scope: { kind: "project", slug: project.slug } }, inProject);
        return createSession({ agent: start.agent, scope: { kind: "kraftwerk" }, ...(start.config ? { config: start.config } : {}) }, (id) => `/agents/chats/${id}`);
      }}
    />
  );
}

/* ---------- what Ralv runs on ---------- */

const START_AGENTS: ChatAgentId[] = ["claude", "codex", "antigravity", "pi"];
const START_KEY = "kw-ralv-start";

interface StartChoice {
  agent: ChatAgentId;
  /** Picked settings by config id (model, thinking depth); absent = the agent's default. */
  picks: Record<string, string>;
}

function readStart(): StartChoice {
  try {
    const v = JSON.parse(localStorage.getItem(START_KEY) ?? "null") as StartChoice | null;
    if (v && START_AGENTS.includes(v.agent)) return { agent: v.agent, picks: v.picks ?? {} };
  } catch {
    /* no storage: the defaults */
  }
  return { agent: "claude", picks: {} };
}

/**
 * Which agent a new Ralv chat runs on and with which model and thinking
 * depth — remembered in this browser. The choices are the ones the agent
 * announces for this login (agents.options), so they are never a stale
 * list; a pick the agent no longer offers falls back to its default.
 */
function useStartChoice() {
  const [choice, setChoice] = useState<StartChoice>(readStart);
  // The server caches what each agent offers; asking again on every switch is cheap after the first time.
  const [offered, setOffered] = useState<{ agent: ChatAgentId; options: ConfigOption[]; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void api.request("agents.options", { query: { agent: choice.agent } }).then((r) => {
      if (alive) setOffered(r.ok ? { agent: choice.agent, options: r.data.options } : { agent: choice.agent, options: [], error: failure(r) });
    });
    return () => {
      alive = false;
    };
  }, [choice.agent]);
  const mine = offered?.agent === choice.agent ? offered : null;
  const options = mine?.options ?? [];
  const save = (next: StartChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(START_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };
  const valid = Object.entries(choice.picks).filter(([id, v]) => options.some((o) => o.id === id && o.type === "select" && o.choices.some((c) => c.value === v)));
  return {
    agent: choice.agent,
    picks: choice.picks,
    options,
    loading: !mine,
    error: mine?.error,
    config: valid.length ? Object.fromEntries(valid) : undefined,
    setAgent: (agent: ChatAgentId) => save({ agent, picks: {} }),
    pick: (id: string, value: string) => {
      const picks = { ...choice.picks };
      if (value) picks[id] = value;
      else delete picks[id];
      save({ ...choice, picks });
    },
  };
}

const pill = "h-8 w-auto max-w-[220px] rounded-full border-0 bg-transparent text-sm font-medium hover:bg-surface-2";

function StartPicker({ agent, picks, options, loading, error, setAgent, pick }: ReturnType<typeof useStartChoice>) {
  return (
    <>
      <Select aria-label="agent" value={agent} onChange={(e) => setAgent(e.target.value as ChatAgentId)} className={pill}>
        {START_AGENTS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Select>
      {loading && <span className="px-2 text-xs text-fg-2">asking {agent} for its models…</span>}
      {error && (
        <span className="max-w-[260px] truncate px-2 text-xs text-bad" title={error}>
          {agent} did not answer — its default model
        </span>
      )}
      {options.map((o) =>
        o.type !== "select" ? null : (
          <Select key={o.id} aria-label={o.category === "model" ? "model" : "thinking"} value={picks[o.id] ?? ""} onChange={(e) => pick(o.id, e.target.value)} className={pill}>
            <option value="">
              {o.category === "model" ? "model" : "thinking"}: default{o.value === "default" ? "" : ` (${o.choices.find((c) => c.value === o.value)?.name ?? o.value})`}
            </option>
            {o.choices
              .filter((c) => c.value !== "default")
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.name}
                </option>
              ))}
          </Select>
        ),
      )}
    </>
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

/** No agents yet: nothing to explain, one thing to do. */
export function AgentsHome() {
  return (
    <div className="empty-action flex justify-center py-16 text-center text-sm text-fg-2">
      <Button variant="primary" icon="add" onClick={() => navigate("/agents/new")}>
        create your first agent
      </Button>
    </div>
  );
}
