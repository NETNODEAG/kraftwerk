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
import { Link, usePoll, fmtWhen } from "./shared";

/**
 * Dashboard (#/): the landing page, built around the agent team — each
 * member as a colleague card with a direct "chat" button and live
 * working/idle state. Below: stat tiles for every artifact kind, the
 * sessions working right now, and one merged recent-changes feed across
 * runs, sessions, and knowledge — all composed client-side from the
 * existing endpoints, no dedicated API.
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
  const wfData = usePoll<{ root: string; workflows: WorkflowSummary[] }>("/api/workflows", false);
  const knowData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const teamData = usePoll<{ root: string; members: TeamMember[] }>("/api/team", false);
  const skillsData = usePoll<{ root: string; skills: SkillInfo[] }>("/api/skills", false);

  const runs = runsData?.runs ?? [];
  const chats = chatsData?.chats ?? [];
  const bundles: BundleInfo[] = knowData?.bundles ?? [];
  const active = chats.filter((c) => c.busy);
  const concepts = bundles.reduce((n, b) => n + b.concepts, 0);
  const workspaceSkills = (skillsData?.skills ?? []).filter((s) => s.source === "workspace");

  return (
    <div className="dash">
      <div className="page-head">
        <h1>dashboard</h1>
      </div>

      <TeamRow members={teamData?.members} chats={chats} />

      <div className="dash-stats">
        <StatTile href="/workflows" label="workflows" value={wfData ? wfData.workflows.length : undefined} />
        <StatTile
          href="/runs"
          label="workflow runs"
          value={runsData ? runs.length : undefined}
          sub={runs.some((r) => r.status === "running") ? `${runs.filter((r) => r.status === "running").length} running` : undefined}
        />
        <StatTile href="/team" label="agents" value={teamData ? teamData.members.length : undefined} />
        <StatTile
          href="/knowledge"
          label="knowledge"
          value={knowData ? bundles.length : undefined}
          sub={knowData ? `${concepts} concepts` : undefined}
        />
        <StatTile href="/skills" label="skills" value={skillsData ? workspaceSkills.length : undefined} sub="workspace" />
        <StatTile
          href="/chats"
          label="sessions"
          value={chatsData ? chats.length : undefined}
          sub={active.length > 0 ? `${active.length} active` : undefined}
        />
      </div>

      <div className="dash-cols">
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">active sessions</span>
          </div>
          {active.length === 0 ? (
            <div className="viewer-note">nothing running right now</div>
          ) : (
            <div className="m3-list">
              {active.map((c) => (
                <Link key={c.id} href={chatHref(c)} className="m3-row m3-link">
                  <span className="lamp running" />
                  <span className="m3-body">
                    <span className="m3-head">{c.title || "new chat"}</span>
                    <span className="m3-sub">
                      {c.agent} · {chatScopeLabel(c)}
                    </span>
                  </span>
                  <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
                  <span className="m3-chev">›</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">recent runs</span>
            <span className="spacer" />
            <Link href="/runs" className="open-raw">
              all runs
            </Link>
          </div>
          {runs.length === 0 ? (
            <div className="viewer-note">no runs yet</div>
          ) : (
            <div className="m3-list">
              {runs.slice(0, 8).map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="m3-row m3-link">
                  <span className={`lamp ${runLamp(r.status)}`} />
                  <span className="m3-body">
                    <span className="m3-head">{r.workflow ?? r.id}</span>
                    <span className="m3-sub">{r.request || r.id}</span>
                  </span>
                  <span className="side-when num">{fmtWhen(r.updatedAt)}</span>
                  <span className="m3-chev">›</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <RecentChanges runs={runs} chats={chats} bundles={bundles} />
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

function StatTile({
  href,
  label,
  value,
  sub,
}: {
  href: string;
  label: string;
  value?: number;
  sub?: string;
}) {
  return (
    <Link href={href} className="dash-stat">
      <span className="dash-num num">{value ?? "…"}</span>
      <span className="microlabel">{label}</span>
      {sub && <span className="dash-sub">{sub}</span>}
    </Link>
  );
}

/* ---------- recent changes feed ---------- */

interface FeedItem {
  at: string;
  kind: "run" | "session" | "knowledge";
  title: string;
  sub: string;
  href: string;
  lamp: string;
}

function RecentChanges({
  runs,
  chats,
  bundles,
}: {
  runs: RunListItem[];
  chats: BusyChat[];
  bundles: BundleInfo[];
}) {
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
      items.push({
        at: c.updatedAt,
        kind: "session",
        title: c.title || "new chat",
        sub: `${c.agent} · ${chatScopeLabel(c)}`,
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
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [runs, chats, bundles]);

  return (
    <section className="panel dash-feed">
      <div className="panel-head">
        <span className="microlabel">recent changes</span>
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
