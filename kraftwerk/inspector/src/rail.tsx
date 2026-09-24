import { Icon, Link, useExpertMode, useFeatures, usePoll } from "./shared";
import type { Agent, ChannelView, ProjectsView } from "./types";

/**
 * The first column: who can be talked to. The general chat, every project,
 * every agent and every channel, each a link into the conversation routes
 * the screens already answer. It replaces the roster sidebars those screens
 * carry on wide windows (globals.css hides them there).
 */
export function ConversationsRail({ chatPath }: { chatPath: string }) {
  const features = useFeatures();
  const expert = useExpertMode();
  const agents = usePoll<{ agents: Agent[] }>("/api/agents", false, 15_000);
  const channels = usePoll<{ channels: ChannelView[] }>("/api/channels", false, 6000);
  const projects = usePoll<ProjectsView>(features.projects ? "/api/projects" : "", false, 15_000);
  const seg = chatPath.split("/").filter(Boolean);
  const at = (kind: string, slug?: string) =>
    seg[0] === kind && (slug === undefined || (seg[1] ? decodeURIComponent(seg[1]) : undefined) === slug);
  const general = seg[0] === "agents" && seg[1] === "chats";

  return (
    <nav className="rail" aria-label="Conversations">
      <div className="rail-list">
        <Link href="/" className={`rail-row rail-home${chatPath === "/" ? " active" : ""}`}>
          <span className="rail-mark" aria-hidden><Icon name="home" /></span>
          <span className="rail-text">
            <span className="rail-name">Home</span>
            <span className="rail-sub">Today: what needs you, what happened</span>
          </span>
        </Link>
        <Link href="/agents/chats" className={`rail-row${general ? " active" : ""}`}>
          <span className="rail-mark" aria-hidden>🎩</span>
          <span className="rail-text">
            <span className="rail-name">Ralv</span>
            <span className="rail-sub">Chief of staff: knows the workspace, advises, launches things</span>
          </span>
        </Link>

        {features.projects && (
          <div className="rail-group" role="group" aria-label="Projects">
            <Link href="/projects" className="rail-group-head">projects</Link>
            {(projects?.projects ?? []).map((p) => (
              <Link key={p.slug} href={`/projects/${encodeURIComponent(p.slug)}`} className={`rail-row${at("projects", p.slug) ? " active" : ""}`} data-project={p.slug}>
                <span className="rail-mark" aria-hidden>{p.status === "done" ? "✅" : p.status === "paused" ? "⏸️" : p.status === "archived" ? "🗄️" : "📁"}</span>
                <span className="rail-text">
                  <span className="rail-name">{p.title}</span>
                  {(p.goal || p.status !== "active") && <span className="rail-sub">{p.goal || p.status}</span>}
                </span>
              </Link>
            ))}
            {projects?.enabled && (expert || (projects.projects ?? []).length === 0) && (
              <Link href="/projects/new" className="rail-add"><Icon name="add" className="ms-sm" /> new project</Link>
            )}
          </div>
        )}

        <div className="rail-group" role="group" aria-label="Agents">
          <Link href="/agents" className="rail-group-head">agents</Link>
          {(agents?.agents ?? []).filter((a) => !a.archived).map((a) => (
            <Link key={a.slug} href={`/agents/${encodeURIComponent(a.slug)}`} className={`rail-row${at("agents", a.slug) || at("team", a.slug) ? " active" : ""}`}>
              <span className="rail-mark" aria-hidden>{a.emoji || "🤖"}</span>
              <span className="rail-text">
                <span className="rail-name">{a.name}</span>
                {a.description && <span className="rail-sub">{a.description}</span>}
              </span>
            </Link>
          ))}
          {expert && <Link href="/agents/new" className="rail-add"><Icon name="add" className="ms-sm" /> new agent</Link>}
        </div>

        <div className="rail-group" role="group" aria-label="Channels">
          <Link href="/channels" className="rail-group-head">channels</Link>
          {(channels?.channels ?? []).map((c) => (
            <Link key={c.slug} href={`/channels/${encodeURIComponent(c.slug)}`} className={`rail-row${at("channels", c.slug) ? " active" : ""}`}>
              <span className="rail-mark rail-hash" aria-hidden>#</span>
              <span className="rail-text">
                <span className="rail-name">
                  {c.name}
                  {(c.busy || c.awaitingApproval) && <span className={`lamp ${c.awaitingApproval ? "blocked" : "running"}`} title={c.awaitingApproval ? "waiting for your approval" : "an agent is working"} />}
                </span>
                <span className="rail-sub">{c.purpose || (c.members.length ? `with ${c.members.map((m) => `@${m}`).join(" ")}` : "no agents yet")}</span>
              </span>
            </Link>
          ))}
          <Link href="/channels/new" className="rail-add"><Icon name="add" className="ms-sm" /> new channel</Link>
        </div>
      </div>
    </nav>
  );
}
