import { listAgents } from "./agents.js";
import { waitingRequests } from "./chat/sessions.js";
import { chatHref, listNotifications } from "./notifications.js";
import { listProjects } from "./projects.js";
import { runnerFindings, type RunnerRef } from "./routines.js";

/**
 * What needs you: every place where work is stuck on a human, with whose it
 * is. Two sources: requests waiting in a live chat (an approval, a question
 * — the agent cannot go on until someone answers) and failures nobody has
 * looked at yet (a routine or a workflow run that ended badly; unread
 * failure notifications). Oldest first: what waits longest comes first.
 * A third, about setup rather than one piece of work: routines nobody runs
 * (enabled, no runs_on) and routines naming an identity this machine has
 * retired — both fire nowhere until someone assigns them a runner.
 *
 * The inspector builds everything urgent from this one list: the counts on
 * the rail, the "needs you" part of the bell, the tab title and "next",
 * which walks through it and lands on each item with its context.
 */

/** Who an item belongs to — what the rail lights up and the bell groups by. */
export interface AttentionOwner {
  project?: { slug: string; title: string };
  agent?: { slug: string; name: string; emoji?: string };
  channel?: string;
  /** A chat with Ralv, the workspace's general assistant. */
  general?: boolean;
  /** A workflow run. */
  workflow?: string;
}

export interface AttentionItem {
  /** The request id (live requests) or the notification id (failures). */
  id: string;
  /** runner: routines without a runner, or naming a retired identity of this machine (see routines.ts). */
  kind: "approval" | "question" | "failed" | "runner";
  /** What is asked, or what went wrong. */
  title: string;
  /** The session it sits in. */
  chatId?: string;
  chatTitle?: string;
  /** Where to go: a chat route with ?focus=<request id>, or the failed run or routine. */
  href: string;
  since: string;
  owner: AttentionOwner;
  /** Failures: the notification to mark read once the item was opened. */
  notificationId?: string;
  /** runner items: the routines concerned; `from` is the retired identity they name. */
  routines?: RunnerRef[];
}

export interface AttentionView {
  items: AttentionItem[];
}

export async function listAttention(): Promise<AttentionView> {
  const [agents, projects, notes, runners] = await Promise.all([
    listAgents().catch(() => []),
    listProjects().catch(() => ({ projects: [] })),
    listNotifications().catch(() => ({ items: [] })),
    runnerFindings().catch(() => ({ unassigned: [], retired: [] }) as Awaited<ReturnType<typeof runnerFindings>>),
  ]);
  const agentOf = (slug: string): AttentionOwner["agent"] => {
    const a = agents.find((x) => x.slug === slug);
    return { slug, name: a?.name ?? slug, ...(a?.emoji ? { emoji: a.emoji } : {}) };
  };
  const projectOf = (slug: string): AttentionOwner["project"] => ({
    slug,
    title: projects.projects.find((p) => p.slug === slug)?.title ?? slug,
  });

  const waiting: AttentionItem[] = waitingRequests().map((w) => {
    const { scope } = w.meta;
    const owner: AttentionOwner = {};
    if (scope.kind === "agent") {
      owner.agent = agentOf(scope.slug);
      // An agent's chat filed under a project waits for you in that project too.
      if (w.meta.project) owner.project = projectOf(w.meta.project);
    }
    if (scope.kind === "project") owner.project = projectOf(scope.slug);
    if (scope.kind === "channel") {
      owner.channel = scope.slug;
      owner.agent = agentOf(w.seat);
      if (w.meta.project) owner.project = projectOf(w.meta.project);
    }
    if (scope.kind === "general" || scope.kind === "kraftwerk" || scope.kind === "knowledge") owner.general = true;
    return {
      id: w.requestId,
      kind: w.kind,
      title: w.title,
      chatId: w.meta.id,
      ...(w.meta.title ? { chatTitle: w.meta.title } : {}),
      href: `${chatHref(w.meta)}?focus=${encodeURIComponent(w.requestId)}`,
      since: w.since,
      owner,
    };
  });

  const failed: AttentionItem[] = notes.items
    .filter((n) => !n.readAt && (n.kind === "routine_failed" || n.kind === "run_failed"))
    .map((n) => {
      const owner: AttentionOwner = {};
      if (n.diagnose?.kind === "routine") owner.agent = agentOf(n.diagnose.agent);
      if (n.diagnose?.kind === "run") owner.workflow = n.title.replace(/ run .*$/, "");
      return {
        id: n.id,
        kind: "failed" as const,
        title: n.body ? `${n.title}: ${n.body.split("\n")[0]}` : n.title,
        ...(n.diagnose?.kind === "routine" && n.diagnose.chatId ? { chatId: n.diagnose.chatId } : {}),
        href: n.href,
        since: n.at,
        owner,
        notificationId: n.id,
      };
    });

  // One item per problem, not per routine: the fix ("run these here") is one action for all of them.
  const since = runners.since ?? new Date(0).toISOString();
  // The fix lives on an agent profile's routines panel (/agents/<slug>/info — /agents/<slug> redirects
  // to a chat). Routines of one agent: that profile and its rail entry; of several: the first agent's
  // profile, whose banner adopts across the whole workspace.
  const placed = (these: RunnerRef[]): Pick<AttentionItem, "href" | "owner"> => {
    const slugs = [...new Set(these.map((r) => r.agent))];
    return slugs.length === 1
      ? { href: `/agents/${slugs[0]}/info`, owner: { agent: agentOf(slugs[0]) } }
      : { href: `/agents/${slugs[0]}/info`, owner: {} };
  };
  const runner: AttentionItem[] = [];
  const n = runners.unassigned.length;
  if (n) {
    runner.push({
      id: "runner:unassigned",
      kind: "runner",
      title: `${n} routine${n === 1 ? " has" : "s have"} no runner — ${n === 1 ? "it fires" : "they fire"} nowhere until a machine runs ${n === 1 ? "it" : "them"}`,
      since,
      ...placed(runners.unassigned),
      routines: runners.unassigned,
    });
  }
  for (const old of [...new Set(runners.retired.map((r) => r.from!))]) {
    const these = runners.retired.filter((r) => r.from === old);
    runner.push({
      id: `runner:retired:${old}`,
      kind: "runner",
      title: `${these.length} routine${these.length === 1 ? " names" : "s name"} a retired identity ${old} — reassign`,
      since,
      ...placed(these),
      routines: these,
    });
  }

  const items = [...waiting, ...failed, ...runner].sort((a, b) => a.since.localeCompare(b.since));
  return { items };
}
