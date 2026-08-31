import { useMemo } from "react";
import type {
  BundleInfo,
  ChatMeta,
  KnowledgeIndex,
  RunListItem,
  SkillInfo,
  TeamMember,
  WorkflowSummary,
} from "./types";
import { createChatAndOpen } from "./chat";
import { Link, usePoll, fmtWhen, useExpertMode } from "./shared";

/**
 * Dashboard (#/): the work surface, not an admin panel. The agent team —
 * each member as a colleague card with a direct "chat" button and live
 * working/idle state — plus one merged activity feed (working items
 * pinned first) across runs, sessions, and knowledge. Inventory counts
 * and config live behind the nav, not here. All composed client-side
 * from the existing endpoints, no dedicated API.
 */

type BusyChat = ChatMeta & { busy: boolean };

const runLamp = (s: RunListItem["status"]) =>
  s === "ok" ? "ok" : s === "running" ? "running" : s === "aborted" ? "aborted" : "failed";

function chatHref(c: ChatMeta): string {
  return c.scope.kind === "team" ? `/team/${c.scope.member}/chat/${c.id}` : `/chats/${c.id}`;
}

function chatScopeLabel(c: ChatMeta): string {
  switch (c.scope.kind) {
    case "team": return c.scope.member;
    case "run": return c.scope.runId;
    case "knowledge": return c.scope.bundle ? `knowledge:${c.scope.bundle}` : "knowledge";
    case "kraftwerk": return "kraftwerk-aware";
    default: return "general";
  }
}

export function DashboardScreen() {
  const runsData = usePoll<{ outputDir: string; runs: RunListItem[] }>("/api/runs", false);
  const chatsData = usePoll<{ chats: BusyChat[] }>("/api/chats", false);
  const knowData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const teamData = usePoll<{ root: string; members: TeamMember[] }>("/api/team", false);
  const wfData = usePoll<{ root: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const skillsData = usePoll<{ root: string; skills: SkillInfo[] }>("/api/skills", false);
  const meta = usePoll<{ projectName?: string; projectIcon?: string }>("/api/meta", false);

  const runs = runsData?.runs ?? [];
  const chats = chatsData?.chats ?? [];
  const bundles: BundleInfo[] = knowData?.bundles ?? [];
  const workspaceSkills = (skillsData?.skills ?? []).filter((s) => s.source === "workspace");
  const mini: Array<[count: number | undefined, label: string, href: string]> = [
    [wfData?.workflows.length, "workflows", "/workflows"],
    [runsData ? runs.length : undefined, "runs", "/runs"],
    [knowData ? bundles.length : undefined, "bundles", "/knowledge"],
    [skillsData ? workspaceSkills.length : undefined, "skills", "/skills"],
    [chatsData ? chats.length : undefined, "sessions", "/chats"],
  ];

  return (
    <div className="dash">
      <div className="page-head">
        <h1>
          {meta?.projectIcon ? `${meta.projectIcon} ` : ""}
          {meta?.projectName || "workspace"}
        </h1>
        <span className="spacer" />
        <span className="dash-mini">
          {mini.map(([count, label, href]) => (
            <Link key={label} href={href}>
              <b className="num">{count ?? "…"}</b> {label}
            </Link>
          ))}
        </span>
      </div>

      <TeamRow members={teamData?.members} chats={chats} />

      <ActivityFeed runs={runs} chats={chats} bundles={bundles} members={teamData?.members ?? []} />
    </div>
  );
}

/* ---------- team ---------- */

/** The team, as colleague cards: presence from live sessions + a chat button. */
function TeamRow({ members, chats }: { members?: TeamMember[]; chats: BusyChat[] }) {
  if (members && members.length === 0) {
    return (
      <section className="panel dash-team-empty">
        <div className="viewer-note">
          No agent teammates yet — <Link href="/team/new">create your first agent</Link> and it
          will show up here, ready to chat.
        </div>
      </section>
    );
  }
  return (
    <div className="dash-team">
      {(members ?? []).map((m) => {
        const sessions = chats.filter((c) => c.scope.kind === "team" && c.scope.member === m.slug);
        const working = sessions.find((c) => c.busy);
        const last = sessions[0]; // /api/chats is sorted by updatedAt desc
        return (
          <div key={m.slug} className="dash-member">
            <Link href={`/team/${encodeURIComponent(m.slug)}`} className="dash-member-id">
              <span className="dash-member-emoji">{m.emoji}</span>
              <span className="dash-member-name">
                {m.name}
                <span className={`lamp ${working ? "running" : "ok"}`} />
              </span>
              <span className="dash-member-desc">{m.description || "(no description yet)"}</span>
            </Link>
            <div className="dash-member-foot">
              <span className="dash-member-state">
                {working ? (
                  <Link href={`/team/${encodeURIComponent(m.slug)}/chat/${working.id}`}>
                    working…
                  </Link>
                ) : last ? (
                  `last active ${fmtWhen(last.updatedAt)}`
                ) : (
                  "never talked yet"
                )}
              </span>
              <button
                className="run-btn dash-chat-btn"
                onClick={() => void createChatAndOpen("claude", { kind: "team", member: m.slug })}
              >
                💬 chat
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- activity feed ---------- */

interface FeedItem {
  at: string;
  kind: "run" | "session" | "knowledge";
  title: string;
  sub: string;
  href: string;
  lamp: string;
}

function ActivityFeed({
  runs,
  chats,
  bundles,
  members,
}: {
  runs: RunListItem[];
  chats: BusyChat[];
  bundles: BundleInfo[];
  members: TeamMember[];
}) {
  const expert = useExpertMode();
  const feed = useMemo(() => {
    const items: FeedItem[] = [];
    for (const r of runs) {
      items.push({
        at: r.updatedAt,
        kind: "run",
        title: r.workflow ?? r.id,
        sub: `${r.status}${r.request ? ` · ${r.request}` : ""}`,
        href: `/runs/${r.id}`,
        lamp: runLamp(r.status),
      });
    }
    for (const c of chats) {
      // Team sessions show the teammate (emoji + name), others the harness + scope.
      const member =
        c.scope.kind === "team"
          ? members.find((m) => c.scope.kind === "team" && m.slug === c.scope.member)
          : undefined;
      items.push({
        at: c.updatedAt,
        kind: "session",
        title: c.title || "new chat",
        // Simple mode drops the harness name — who worked, not what ran it.
        sub: member
          ? `${member.emoji} ${member.name}${expert ? ` · ${c.agent}` : ""}`
          : expert
            ? `${c.agent} · ${chatScopeLabel(c)}`
            : chatScopeLabel(c),
        href: chatHref(c),
        lamp: c.busy ? "running" : "ok",
      });
    }
    for (const b of bundles) {
      if (!b.updatedAt) continue;
      items.push({
        at: b.updatedAt,
        kind: "knowledge",
        title: b.name,
        sub: `${b.concepts} concepts`,
        href: `/knowledge/${encodeURIComponent(b.name)}`,
        lamp: "ok",
      });
    }
    // Anything still working comes first; the rest by recency.
    return items
      .sort((a, b) => {
        const run = Number(b.lamp === "running") - Number(a.lamp === "running");
        return run !== 0 ? run : b.at.localeCompare(a.at);
      })
      .slice(0, 15);
  }, [runs, chats, bundles, members, expert]);

  return (
    <section className="panel dash-feed">
      <div className="panel-head">
        <span className="microlabel">activity</span>
        <span className="spacer" />
        <Link href="/runs" className="open-raw">
          all runs
        </Link>
      </div>
      {feed.length === 0 ? (
        <div className="viewer-note">nothing yet — run a workflow or start a session</div>
      ) : (
        <div className="m3-list">
          {feed.map((f) => (
            <Link key={`${f.kind}:${f.href}:${f.at}`} href={f.href} className="m3-row m3-link">
              <span className={`lamp ${f.lamp}`} />
              <span className={`chip dash-kind ${f.kind}`}>{f.kind}</span>
              <span className="m3-body">
                <span className="m3-head">{f.title}</span>
                <span className="m3-sub">{f.sub}</span>
              </span>
              <span className="side-when num">{fmtWhen(f.at)}</span>
              <span className="m3-chev">›</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
