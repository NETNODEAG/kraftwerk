import { listAgents } from "./agents.js";
import { waitingRequests } from "./chat/sessions.js";
import { chatHref, listNotifications } from "./notifications.js";
import { listProjects } from "./projects.js";

/**
 * What needs you: every place where work is stuck on a human, with whose it
 * is. Two sources: requests waiting in a live chat (an approval, a question
 * — the agent cannot go on until someone answers) and failures nobody has
 * looked at yet (a routine or a workflow run that ended badly; unread
 * failure notifications). Oldest first: what waits longest comes first.
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
  kind: "approval" | "question" | "failed";
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
}

export interface AttentionView {
  items: AttentionItem[];
}

export async function listAttention(): Promise<AttentionView> {
  const [agents, projects, notes] = await Promise.all([
    listAgents().catch(() => []),
    listProjects().catch(() => ({ projects: [] })),
    listNotifications().catch(() => ({ items: [] })),
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
    if (scope.kind === "agent") owner.agent = agentOf(scope.slug);
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

  const items = [...waiting, ...failed].sort((a, b) => a.since.localeCompare(b.since));
  return { items };
}
