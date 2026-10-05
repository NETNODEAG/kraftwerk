import { listAgents } from "./agents.js";
import { agentActivity, listChats, type AgentActivity } from "./chat/sessions.js";
import { routineStatuses } from "./routines.js";

/**
 * What each agent is up to, for the status line under its name: waiting on
 * a human, working (where, since when), the next scheduled routine, and
 * when it was last active. The UI picks the one line that matters most.
 */
export interface AgentStatus {
  /** Chats where it waits for an approval or an answer. */
  waiting: AgentActivity[];
  /** Chats where it is mid-turn. */
  working: AgentActivity[];
  /** The next enabled routine due. */
  nextRoutine?: { id: string; name: string; at: string };
  /** Newest change in any of its sessions or channels. */
  lastActiveAt?: string;
}

export async function agentStatuses(): Promise<Record<string, AgentStatus>> {
  const [agents, chats] = await Promise.all([listAgents(), listChats()]);
  const live = agentActivity();
  const out: Record<string, AgentStatus> = {};
  await Promise.all(
    agents.map(async (a) => {
      const act = live.get(a.slug);
      const routines = await routineStatuses(a.slug).catch(() => []);
      const next = routines
        .filter((r) => r.nextRunAt)
        .sort((x, y) => x.nextRunAt!.localeCompare(y.nextRunAt!))[0];
      // A channel chat counts once the agent has a session there (sessions are keyed by agent slug).
      const mine = chats.filter((c) => (c.scope.kind === "agent" && c.scope.slug === a.slug) || (c.scope.kind === "channel" && c.sessions?.[a.slug]));
      const last = mine.reduce<string | undefined>((m, c) => (!m || c.updatedAt > m ? c.updatedAt : m), undefined);
      out[a.slug] = {
        waiting: act?.waiting ?? [],
        working: act?.working ?? [],
        ...(next ? { nextRoutine: { id: next.id, name: next.name, at: next.nextRunAt! } } : {}),
        ...(last ? { lastActiveAt: last } : {}),
      };
    })
  );
  return out;
}
