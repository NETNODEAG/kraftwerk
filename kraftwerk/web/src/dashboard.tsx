import { useMemo, useState } from "react";
import type {
  BundleInfo,
  ChatMeta,
  RunListItem,
  Agent,
  WorkflowSummary,
} from "./types";
import { useApi } from "./api";
import { Icon, Link, fmtAgo, useExpertMode, useHashPath } from "./shared";
import { nextItem, openAttention, ownerText, useAttention } from "./attention";
import { Button, cn, Dot, Eyebrow, ListRow, Panel, Tag } from "./ui";

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

/** Whose a chat is, the way a person says it: "🐻 Max", "📁 Relaunch netnode.ch", "#launch", "🎩 Ralv". */
function chatOwner(c: ChatMeta, agents: Agent[], projectTitle: (slug: string) => string): string {
  switch (c.scope.kind) {
    case "agent": {
      const slug = c.scope.slug;
      const a = agents.find((m) => m.slug === slug);
      return a ? `${a.emoji || "🤖"} ${a.name}` : slug;
    }
    case "project": return `📁 ${projectTitle(c.scope.slug)}`;
    case "channel": return c.project ? `📁 ${projectTitle(c.project)} · #${c.scope.slug}` : `#${c.scope.slug}`;
    case "run": return `⚙️ run ${c.scope.runId}`;
    case "knowledge": return c.scope.bundle ? `📚 ${c.scope.bundle}` : "📚 knowledge";
    default: return "🎩 Ralv";
  }
}

/** Middle-truncate long titles (raw URLs, pasted first messages). */
function trimTitle(t: string): string {
  return t.length > 64 ? `${t.slice(0, 46)}…${t.slice(-14)}` : t;
}

export function DashboardScreen() {
  const runsData = useApi("runs.list", {});
  const chatsData = useApi("chats.list", {});
  const knowData = useApi("knowledge.list", {});
  const agentsData = useApi("agents.list", {});
  const wfData = useApi("workflows.list", {});
  const skillsData = useApi("skills.list", {});
  const [filter, setFilter] = useState<FeedFilter>("all");
  const expert = useExpertMode();
  const projectsData = useApi("projects.list", {}, { interval: 30_000 });
  const projectTitle = (slug: string) => projectsData?.projects.find((p) => p.slug === slug)?.title ?? slug;

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
    <div className="w-full px-7 pt-6 pb-10 max-[800px]:px-3 max-[800px]:pt-3">
      <Today runs={runs} chats={chats} bundles={bundles} agents={agentsData?.agents ?? []} workflows={wfData?.workflows ?? []} projectTitle={projectTitle} loaded={!!runsData && !!chatsData} />
      {/* Expert mode: the inventory and the whole activity, filterable, below today. */}
      {expert && (
        <div className="mx-0.5 mt-3.5 mb-3 flex flex-wrap justify-end gap-x-[18px] gap-y-1 text-xs text-fg-2 max-[800px]:justify-start max-[800px]:gap-x-3.5">
          {mini.map(([count, label, href]) => (
            <Link key={label} href={href} className="group/mini text-inherit no-underline hover:text-accent hover:underline">
              <b className="font-semibold tabular-nums text-fg group-hover/mini:text-accent">{count ?? "…"}</b> {label}
            </Link>
          ))}
        </div>
      )}

      {expert && failed.length > 0 && filter !== "failed" && (
        <button
          type="button"
          className="mb-3.5 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-bad/40 bg-bad-soft px-3.5 py-[9px] text-left text-[12.5px] text-on-bad-soft hover:brightness-104"
          onClick={() => setFilter("failed")}
        >
          ⚠ {failed.length} run{failed.length === 1 ? "" : "s"} failed in the last 24 h — review
        </button>
      )}

      {expert && <ActivityFeed
        projectTitle={projectTitle}
        runs={runs}
        chats={chats}
        bundles={bundles}
        agents={agentsData?.agents ?? []}
        workflows={wfData?.workflows ?? []}
        filter={filter}
        setFilter={setFilter}
      />}
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
  projectTitle,
  runs,
  chats,
  bundles,
  agents,
  workflows,
  filter,
  setFilter,
}: {
  projectTitle: (slug: string) => string;
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
            ? `${c.agent} · ${chatOwner(c, agents, projectTitle)}`
            : chatOwner(c, agents, projectTitle),
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
  const chip = (on: boolean, bad?: boolean) =>
    cn(
      "inline-flex cursor-pointer items-center gap-0.5 rounded-lg border px-2.5 py-0.5 text-2xs transition-colors",
      on
        ? cn("border-transparent", bad ? "bg-bad-soft text-on-bad-soft" : "bg-accent-soft text-on-accent-soft")
        : "border-line bg-transparent text-fg-2 hover:text-fg"
    );

  return (
    <Panel
      className="animate-rise"
      title="all activity"
      actions={
        <span className="flex flex-wrap gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={chip(filter === k)} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
          {filter === "failed" && (
            <button type="button" className={chip(true, true)} onClick={() => setFilter("all")}>
              failed <Icon name="close" className="ms-sm" />
            </button>
          )}
        </span>
      }
    >
      {feed.length === 0 ? (
        <div className="px-[18px] py-4 text-sm text-fg-2">
          {filter === "all"
            ? "nothing yet — run a workflow or start a chat"
            : "nothing here for this filter"}
        </div>
      ) : (
        <div className="flex flex-col p-1.5">
          {feed.map((f) => {
            const bucket = dayBucket(f);
            const sep = bucket !== lastBucket ? bucket : null;
            lastBucket = bucket;
            return (
              <div key={`${f.kind}:${f.href}:${f.at}`}>
                {sep && <Eyebrow className="block px-2.5 pt-3 pb-1">{sep}</Eyebrow>}
                <ListRow
                  href={f.href}
                  leading={
                    // The face, with a presence dot that shows only while actually working.
                    <span className="relative text-[18px] leading-none">
                      <span aria-hidden>{f.emoji}</span>
                      {f.lamp === "running" && (
                        <span className="absolute -right-1 -bottom-1 grid rounded-full bg-surface p-px">
                          <Dot tone="working" />
                        </span>
                      )}
                    </span>
                  }
                  title={trimTitle(f.title)}
                  // On a phone the face says what it is; the name needs the room.
                  titleExtra={<span className="max-[800px]:hidden"><Tag tone={KIND_TONE[f.kind]}>{f.kind === "session" ? "chat" : f.kind}</Tag></span>}
                  sub={f.sub && trimTitle(f.sub)}
                  meta={
                    <span className="flex items-center gap-2">
                      {f.status && <Tag tone={STATUS_TONE[f.lamp] ?? "neutral"}>{f.status}</Tag>}
                      <span title={new Date(f.at).toLocaleString()}>{fmtAgo(f.at)}</span>
                      <Icon name="chevron_right" className="ms-sm max-[800px]:hidden" />
                    </span>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const KIND_TONE: Record<FeedItem["kind"], "accent" | "ask" | "ok"> = { run: "accent", session: "ask", knowledge: "ok" };
const STATUS_TONE: Record<string, "ok" | "bad" | "accent" | "neutral"> = { ok: "ok", failed: "bad", blocked: "bad", running: "accent", aborted: "neutral" };

/* ---------- today ---------- */

/** "4 min", "1 h 20 min" — how long something has been going. */
function since(iso?: string): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return "just started";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

interface TodayRow {
  key: string;
  owner: string;
  title: string;
  meta: string;
  href: string;
  tone?: "waiting" | "working";
}

/**
 * Home, in three plain sections: what needs you (the attention list, with
 * "next"), what is in progress (agents mid-turn, running workflows), and
 * what got done today (chats with new answers, finished runs, knowledge
 * that changed). Every row says whose it is first.
 */
function Today({
  runs,
  chats,
  bundles,
  agents,
  workflows,
  projectTitle,
  loaded,
}: {
  runs: RunListItem[];
  chats: BusyChat[];
  bundles: BundleInfo[];
  agents: Agent[];
  workflows: WorkflowSummary[];
  projectTitle: (slug: string) => string;
  loaded: boolean;
}) {
  const waiting = useAttention() ?? [];
  const hash = useHashPath();
  const status = useApi("agents.status", {}, { interval: 5000 });
  const wfName = (slug?: string) => (slug ? (workflows.find((w) => w.slug === slug)?.name ?? slug) : "workflow");
  // When a chat's turn started, from the agents' status (the chat list does not carry it).
  const startedAt = new Map<string, string>();
  for (const st of Object.values(status ?? {})) for (const w of st.working) if (w.since) startedAt.set(w.chatId, w.since);

  const progress: TodayRow[] = [
    ...chats
      .filter((c) => c.busy && !c.awaitingApproval)
      .map((c) => ({
        key: `c:${c.id}`,
        owner: chatOwner(c, agents, projectTitle),
        title: trimTitle(c.title || "new chat"),
        meta: `working${startedAt.get(c.id) ? ` · ${since(startedAt.get(c.id))}` : ""}`,
        href: chatHref(c),
        tone: "working" as const,
      })),
    ...runs
      .filter((r) => r.status === "running")
      .map((r) => ({
        key: `r:${r.id}`,
        owner: `⚙️ ${wfName(r.workflow)}`,
        title: trimTitle(r.request ?? ""),
        meta: "running",
        href: `/runs/${r.id}`,
        tone: "working" as const,
      })),
  ];

  const done: TodayRow[] = [
    ...chats
      .filter((c) => !c.busy && !c.awaitingApproval && isToday(c.updatedAt) && c.title)
      .map((c) => ({ key: `c:${c.id}`, at: c.updatedAt, owner: chatOwner(c, agents, projectTitle), title: trimTitle(c.title), meta: fmtAgo(c.updatedAt), href: chatHref(c) })),
    ...runs
      .filter((r) => r.status !== "running" && isToday(r.updatedAt))
      .map((r) => ({
        key: `r:${r.id}`,
        at: r.updatedAt,
        owner: `⚙️ ${wfName(r.workflow)}`,
        title: trimTitle(r.request ?? ""),
        meta: `${r.status === "ok" ? "done" : r.status === "aborted" ? "stopped" : "failed"} · ${fmtAgo(r.updatedAt)}`,
        href: `/runs/${r.id}`,
      })),
    ...bundles
      .filter((b) => b.updatedAt && isToday(b.updatedAt))
      .map((b) => ({ key: `k:${b.name}`, at: b.updatedAt!, owner: `📚 ${b.name}`, title: "knowledge updated", meta: fmtAgo(b.updatedAt!), href: `/knowledge/${encodeURIComponent(b.name)}` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  const next = nextItem(waiting, hash);
  const quiet = loaded && waiting.length === 0 && progress.length === 0;

  return (
    <div className="today flex flex-col gap-3.5">
      <Panel
        className="today-section"
        title="needs you"
        count={waiting.length}
        actions={
          next && (
            <Button variant="primary" size="sm" onClick={() => openAttention(next)} className="bg-bad text-on-bad hover:bg-bad">
              start <Icon name="arrow_forward" className="ms-sm" />
            </Button>
          )
        }
      >
        {waiting.length === 0 ? (
          <p className="m-0 px-[18px] py-4 text-sm text-fg-2">{quiet ? "Nothing waiting, nothing running." : "Nothing is waiting for you."}</p>
        ) : (
          <div className="p-1.5">
            {waiting.map((i) => (
              <ListRow
                key={i.id}
                className="today-row waiting"
                onClick={() => openAttention(i)}
                over={ownerText(i.owner)}
                title={i.title}
                meta={<span className="font-semibold text-bad">{i.kind === "approval" ? "needs approval" : i.kind === "question" ? "asks you" : "failed"} · {fmtAgo(i.since)}</span>}
              />
            ))}
          </div>
        )}
        {quiet && (
          <div className="px-[18px] pb-4">
            <Button variant="primary" icon="chat" href="/agents/chats">chat with Ralv</Button>
          </div>
        )}
      </Panel>

      {progress.length > 0 && (
        <Panel className="today-section" title="in progress">
          <div className="p-1.5">{progress.map((r) => <Row key={r.key} r={r} />)}</div>
        </Panel>
      )}

      <Panel className="today-section" title="done today">
        {done.length === 0 ? (
          <p className="m-0 px-[18px] py-4 text-sm text-fg-2">Nothing finished yet today.</p>
        ) : (
          <div className="p-1.5">{done.map((r) => <Row key={r.key} r={r} />)}</div>
        )}
      </Panel>
    </div>
  );
}

function Row({ r }: { r: TodayRow }) {
  return (
    <ListRow
      className="today-row"
      href={r.href}
      over={r.owner}
      title={r.title}
      meta={
        <span className="inline-flex items-center gap-1.5">
          {r.tone === "working" && <Dot tone="working" />}
          {r.meta}
        </span>
      }
    />
  );
}
