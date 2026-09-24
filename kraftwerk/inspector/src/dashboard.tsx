import { useEffect, useMemo, useState } from "react";
import type {
  BundleInfo,
  ChatMeta,
  KnowledgeIndex,
  RunListItem,
  SkillInfo,
  Agent,
  WorkflowSummary,
} from "./types";
import { createChatAndOpen } from "./chat";
import { Icon, Link, navigate, usePoll, fmtAgo, useExpertMode } from "./shared";

/**
 * Dashboard (#/): the work surface, not an admin panel. Quick actions to
 * start work (run a workflow, open a chat), the agents — each one
 * as a colleague card with a direct "chat" button and live working/idle
 * state — a failed-runs attention strip, plus one merged, filterable
 * activity feed (working items pinned first, grouped by day) across
 * runs, chats, and knowledge. Inventory counts and config live behind
 * the nav, not here. All composed client-side from the existing
 * endpoints, no dedicated API.
 */

type BusyChat = ChatMeta & { busy: boolean; awaitingApproval?: boolean };

const runLamp = (s: RunListItem["status"]) =>
  s === "ok" ? "ok" : s === "running" ? "running" : s === "aborted" ? "aborted" : "failed";

/** Status as a word, not just a colored dot. */
const runStatusLabel = (s: RunListItem["status"]) =>
  s === "ok" ? "done" : s === "running" ? "working" : s === "aborted" ? "stopped" : "failed";

function chatHref(c: ChatMeta): string {
  if (c.scope.kind === "channel") return `/channels/${c.scope.slug}`;
  if (c.scope.kind === "project") return `/projects/${c.scope.slug}/chat/${c.id}`;
  return c.scope.kind === "agent" ? `/agents/${c.scope.slug}/chat/${c.id}` : `/agents/chats/${c.id}`;
}

function chatScopeLabel(c: ChatMeta): string {
  switch (c.scope.kind) {
    case "agent": return c.scope.slug;
    case "channel": return `#${c.scope.slug}`;
    case "run": return c.scope.runId;
    case "knowledge": return c.scope.bundle ? `knowledge:${c.scope.bundle}` : "knowledge";
    case "kraftwerk": return "kraftwerk-aware";
    case "project": return `project:${c.scope.slug}`;
    default: return "general";
  }
}

/** Middle-truncate long titles (raw URLs, pasted first messages). */
function trimTitle(t: string): string {
  return t.length > 64 ? `${t.slice(0, 46)}…${t.slice(-14)}` : t;
}

export function DashboardScreen() {
  const runsData = usePoll<{ outputDir: string; runs: RunListItem[] }>("/api/runs", false);
  const chatsData = usePoll<{ chats: BusyChat[] }>("/api/chats", false);
  const knowData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const agentsData = usePoll<{ root: string; agents: Agent[] }>("/api/agents", false);
  const wfData = usePoll<{ root: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const skillsData = usePoll<{ root: string; skills: SkillInfo[] }>("/api/skills", false);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const runs = runsData?.runs ?? [];
  const chats = chatsData?.chats ?? [];
  const bundles: BundleInfo[] = knowData?.bundles ?? [];
  const workspaceSkills = (skillsData?.skills ?? []).filter((s) => s.source === "workspace");
  const mini: Array<[count: number | undefined, label: string, href: string]> = [
    [wfData?.workflows.length, "workflows", "/workflows"],
    [runsData ? runs.length : undefined, "runs", "/runs"],
    [knowData ? bundles.length : undefined, "bundles", "/knowledge"],
    [skillsData ? workspaceSkills.length : undefined, "skills", "/skills"],
    [chatsData ? chats.length : undefined, "chats", "/agents/chats"],
  ];

  // Recent failures deserve a visible flag, not a scroll position.
  const failed = runs.filter(
    (r) => r.status === "failed" && Date.now() - Date.parse(r.updatedAt) < 24 * 3600e3,
  );

  return (
    <div className="dash">
      {/* The workspace's name is the sign on the panel; the head keeps only the inventory (expert mode). */}
      <div className="page-head dash-head">
        <span className="spacer" />
        <span className="dash-mini">
          {mini.map(([count, label, href]) => (
            <Link key={label} href={href}>
              <b className="num">{count ?? "…"}</b> {label}
            </Link>
          ))}
        </span>
      </div>

      {failed.length > 0 && filter !== "failed" && (
        <button className="dash-alert" onClick={() => setFilter("failed")}>
          ⚠ {failed.length} run{failed.length === 1 ? "" : "s"} failed in the last 24 h — review
        </button>
      )}

      <ActivityFeed
        runs={runs}
        chats={chats}
        bundles={bundles}
        agents={agentsData?.agents ?? []}
        workflows={wfData?.workflows ?? []}
        filter={filter}
        setFilter={setFilter}
      />
    </div>
  );
}

/* ---------- activity feed ---------- */

type FeedFilter = "all" | "run" | "session" | "knowledge" | "failed";

interface FeedItem {
  at: string;
  kind: "run" | "session" | "knowledge";
  /** Avatar face: the agent's emoji, or a kind glyph for agent-less rows. */
  emoji: string;
  title: string;
  sub: string;
  href: string;
  lamp: string;
  /** Labeled state chip ("done", "failed", "working"); omitted where there is nothing to report. */
  status?: string;
}

/** Working items land in "now"; the rest bucket by calendar day. */
function dayBucket(f: FeedItem): string {
  if (f.lamp === "running") return "now";
  const d = new Date(f.at);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return "earlier";
}

const FILTERS: Array<[FeedFilter, string]> = [
  ["all", "all"],
  ["run", "runs"],
  ["session", "chats"],
  ["knowledge", "knowledge"],
];

function ActivityFeed({
  runs,
  chats,
  bundles,
  agents,
  workflows,
  filter,
  setFilter,
}: {
  runs: RunListItem[];
  chats: BusyChat[];
  bundles: BundleInfo[];
  agents: Agent[];
  workflows: WorkflowSummary[];
  filter: FeedFilter;
  setFilter: (f: FeedFilter) => void;
}) {
  const expert = useExpertMode();
  const feed = useMemo(() => {
    const items: FeedItem[] = [];
    // Runs speak human: workflow display name, the request as the story,
    // and the outcome as a labeled chip instead of an "ok ·" prefix.
    const wfName = (slug?: string) =>
      slug ? (workflows.find((w) => w.slug === slug)?.name ?? slug) : undefined;
    for (const r of runs) {
      items.push({
        at: r.updatedAt,
        kind: "run",
        emoji: "⚙️",
        title: wfName(r.workflow) ?? r.id,
        sub: r.request ?? "",
        href: `/runs/${r.id}`,
        lamp: runLamp(r.status),
        status: runStatusLabel(r.status),
      });
    }
    for (const c of chats) {
      // Agent sessions show the agent (emoji + name), others the harness + scope.
      const agent =
        c.scope.kind === "agent"
          ? agents.find((m) => c.scope.kind === "agent" && m.slug === c.scope.slug)
          : undefined;
      // The agent leads the row — their face as avatar, their name as the
      // headline; what was discussed becomes the supporting line. Simple mode
      // drops the harness name — who worked, not what ran it.
      items.push({
        at: c.updatedAt,
        kind: "session",
        emoji: agent ? agent.emoji || "🤖" : "💬",
        title: agent ? agent.name : c.title || "new chat",
        sub: agent
          ? `${c.title || "new chat"}${expert ? ` · ${c.agent}` : ""}`
          : expert
            ? `${c.agent} · ${chatScopeLabel(c)}`
            : chatScopeLabel(c),
        href: chatHref(c),
        lamp: c.awaitingApproval ? "blocked" : c.busy ? "running" : "ok",
        status: c.awaitingApproval ? "needs approval" : c.busy ? "working" : undefined,
      });
    }
    for (const b of bundles) {
      if (!b.updatedAt) continue;
      items.push({
        at: b.updatedAt,
        kind: "knowledge",
        emoji: "📚",
        title: b.name,
        sub: `${b.concepts} concepts`,
        href: `/knowledge/${encodeURIComponent(b.name)}`,
        lamp: "ok",
      });
    }
    const visible =
      filter === "all"
        ? items
        : filter === "failed"
          ? items.filter((i) => i.kind === "run" && i.lamp === "failed")
          : items.filter((i) => i.kind === filter);
    // Anything still working comes first; the rest by recency.
    return visible
      .sort((a, b) => {
        const run = Number(b.lamp === "running") - Number(a.lamp === "running");
        return run !== 0 ? run : b.at.localeCompare(a.at);
      })
      .slice(0, 15);
  }, [runs, chats, bundles, agents, expert, filter]);

  // Thin day separators; emitted whenever the bucket changes down the list.
  let lastBucket = "";

  return (
    <section className="panel dash-feed">
      <div className="panel-head">
        <span className="microlabel">activity</span>
        <span className="spacer" />
        <span className="dash-feed-filter">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              className={`feed-chip ${filter === k ? "on" : ""}`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
          {filter === "failed" && (
            <button className="feed-chip on failed" onClick={() => setFilter("all")}>
              failed <Icon name="close" className="ms-sm" />
            </button>
          )}
        </span>
      </div>
      {feed.length === 0 ? (
        <div className="viewer-note">
          {filter === "all"
            ? "nothing yet — run a workflow or start a session"
            : "nothing here for this filter"}
        </div>
      ) : (
        <div className="m3-list">
          {feed.map((f) => {
            const bucket = dayBucket(f);
            const sep = bucket !== lastBucket ? bucket : null;
            lastBucket = bucket;
            return (
              <div key={`${f.kind}:${f.href}:${f.at}`} className="feed-group">
                {sep && <div className="feed-day microlabel">{sep}</div>}
                <Link href={f.href} className="m3-row m3-link">
                  {/* Avatar with a presence dot: pulses only while actually working. */}
                  <span className="agent-avatar">
                    <span aria-hidden>{f.emoji}</span>
                    {f.lamp === "running" && <span className="lamp running" />}
                  </span>
                  <span className={`chip dash-kind ${f.kind}`}>
                    {f.kind === "session" ? "chat" : f.kind}
                  </span>
                  <span className="m3-body">
                    <span className="m3-head">{trimTitle(f.title)}</span>
                    {f.sub && <span className="m3-sub">{trimTitle(f.sub)}</span>}
                  </span>
                  {f.status && <span className={`chip status ${f.lamp}`}>{f.status}</span>}
                  <span className="side-when num" title={new Date(f.at).toLocaleString()}>
                    {fmtAgo(f.at)}
                  </span>
                  <span className="m3-chev"><Icon name="chevron_right" /></span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
