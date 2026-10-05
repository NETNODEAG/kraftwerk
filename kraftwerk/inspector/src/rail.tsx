import { Fragment, useEffect, useState } from "react";
import { statusLine } from "../../src/inspector/status-line";
import { attentionFor, useAttention } from "./attention";
import { Icon, Link, PROJECT_ASSISTANT, PROJECTS_CHANGED_EVENT, useExpertMode, useFeatures, usePoll } from "./shared";
import { Badge, Button, Dot, IconButton, ListRow } from "./ui";
import type { Agent, AgentStatus, ChannelView, ProjectsView, VibeablesView } from "./types";

/**
 * The first column: who can be talked to. The general chat, every project,
 * every agent and every channel, each a link into the conversation routes
 * the screens already answer. It replaces the roster sidebars those screens
 * carry on wide windows (shell.css hides them there).
 */
export function ConversationsRail({ chatPath }: { chatPath: string }) {
  const features = useFeatures();
  const expert = useExpertMode();
  const agents = usePoll<{ agents: Agent[] }>("/api/agents", false, 15_000);
  const channels = usePoll<{ channels: ChannelView[] }>("/api/channels", false, 6000);
  // A pin or unpin elsewhere bumps the url, which refetches the list at once.
  const [projectsRev, setProjectsRev] = useState(0);
  useEffect(() => {
    const bump = () => setProjectsRev((n) => n + 1);
    window.addEventListener(PROJECTS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, bump);
  }, []);
  const projects = usePoll<ProjectsView>(features.projects ? `/api/projects${projectsRev ? `?rev=${projectsRev}` : ""}` : "", false, 15_000);
  const status = usePoll<Record<string, AgentStatus>>("/api/agent-status", false, 5000);
  const vibes = usePoll<VibeablesView>(features.vibeables ? "/api/vibeables" : "", false, 15_000);
  const vibeSlugs = new Set((vibes?.vibeables ?? []).map((v) => v.slug));
  const seg = chatPath.split("/").filter(Boolean);
  const at = (kind: string, slug?: string) =>
    seg[0] === kind && (slug === undefined || (seg[1] ? decodeURIComponent(seg[1]) : undefined) === slug);
  const general = seg[0] === "agents" && seg[1] === "chats";
  const [fold, setFold] = useFold();
  // The project you were last in: it stays open while you visit its agents and
  // apps (or anything else); only its chevron, or going into another project, folds it.
  const [held, setHeld] = useState<string>();
  const inProject = seg[0] === "projects" && seg[1] && seg[1] !== "new" ? decodeURIComponent(seg[1]) : undefined;
  useEffect(() => {
    if (inProject) setHeld(inProject);
  }, [inProject]);
  // What waits for you, counted on every row that leads there.
  const waiting = useAttention() ?? [];
  const agentBySlug = new Map((agents?.agents ?? []).filter((a) => !a.archived).map((a) => [a.slug, a]));

  const projectList = projects?.projects ?? [];
  const teamOf = (p: ProjectsView["projects"][number]) =>
    (p.agents ?? []).map((slug) => agentBySlug.get(slug)).filter((a): a is Agent => !!a);
  // Where you are: in the project, or in one of its agents having come from it.
  const here = (p: ProjectsView["projects"][number]) =>
    at("projects", p.slug) || (p.slug === held && teamOf(p).some((a) => at("agents", a.slug)));
  return (
    <nav className="rail" aria-label="Conversations">
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-4">
        <ListRow
          href="/"
          active={chatPath === "/"}
          leading={<Icon name="home" />}
          title="Home"
          sub="Today: what needs you, what happened"
        />
        <ListRow
          href="/agents/chats"
          active={general}
          leading={<span aria-hidden>🎩</span>}
          title="Ralv"
          titleExtra={<Badge n={attentionFor.general(waiting).length} title="waiting for you" />}
          sub="Chief of staff: knows the workspace, advises, launches things"
        />

        {features.projects && (
          <Group
            label="projects"
            href="/projects"
            add={projects?.enabled ? { href: "/projects/new", label: "new project" } : undefined}
            badge={
              fold.all ? (
                <Badge
                  n={new Set(projectList.filter((p) => !here(p)).flatMap((p) => attentionFor.project(waiting, p.slug, p.agents).map((i) => i.id))).size}
                  title="waiting in the projects folded away"
                />
              ) : undefined
            }
            fold={
              projectList.length > 0 ? (
                <IconButton
                  size="sm"
                  icon={fold.all ? "chevron_right" : "expand_more"}
                  label={fold.all ? "show all projects" : "collapse projects"}
                  aria-expanded={!fold.all}
                  onClick={() => setFold((f) => ({ ...f, all: !f.all }))}
                />
              ) : undefined
            }
          >
            {/* Collapsed, the group keeps only the project you are in. */}
            {projectList.filter((p) => !fold.all || here(p)).map((p) => {
              const team = teamOf(p);
              const apps = features.vibeables ? (p.vibeables ?? []).filter((v) => vibeSlugs.has(v)) : [];
              // Open: as its chevron left it; untouched, the project you were last in. Every project
              // has its assistant under it, so every project folds.
              const open = fold.open[p.slug] ?? p.slug === (inProject ?? held);
              const busy = team.map((a) => status?.[a.slug]).filter((s): s is AgentStatus => !!s);
              const working = !open && busy.some((s) => s.working.length && !s.waiting.length);
              return (
                <Fragment key={p.slug}>
                  <ListRow
                    href={`/projects/${encodeURIComponent(p.slug)}`}
                    // Open, the assistant row below is where you are; folded, the project row says it.
                    active={at("projects", p.slug) && !open}
                    innerProps={{ "data-project": p.slug }}
                    leading={<span aria-hidden>{p.status === "done" ? "✅" : p.status === "paused" ? "⏸️" : p.status === "archived" ? "🗄️" : "📁"}</span>}
                    title={p.title}
                    titleExtra={
                      <>
                        <Badge n={attentionFor.project(waiting, p.slug, p.agents).length} title="waiting for you" />
                        {working && <Dot tone="working" title="an agent is working" />}
                      </>
                    }
                    sub={p.goal || (p.status !== "active" ? p.status : undefined)}
                    actionsAlways
                    actions={
                      <IconButton
                        size="sm"
                        icon={open ? "expand_more" : "chevron_right"}
                        label={`${open ? "collapse" : "expand"} ${p.title}`}
                        aria-expanded={open}
                        title={open ? "hide its assistant, agents and apps" : ["the assistant", team.length && `${team.length} agent${team.length === 1 ? "" : "s"}`, apps.length && `${apps.length} app${apps.length === 1 ? "" : "s"}`].filter(Boolean).join(", ")}
                        onClick={() => setFold((f) => ({ ...f, open: { ...f.open, [p.slug]: !open } }))}
                      />
                    }
                  />
                  {/* The project's assistant first, like Ralv for the workspace: the project's own chats. */}
                  {open && (
                    <ListRow
                      className={NESTED}
                      size="sm"
                      href={`/projects/${encodeURIComponent(p.slug)}`}
                      active={at("projects", p.slug)}
                      innerProps={{ title: `${p.title}'s assistant: knows its brief, state and links`, "data-nested": "assistant" }}
                      leading={<span aria-hidden>{PROJECT_ASSISTANT.emoji}</span>}
                      title={<span className="font-medium">{PROJECT_ASSISTANT.name}</span>}
                      titleExtra={<Badge n={waiting.filter((i) => i.owner.project?.slug === p.slug && !i.owner.agent).length} title="waiting for you" />}
                    />
                  )}
                  {/* The agents linked to the project, one level in: who works on it. */}
                  {open &&
                    team.map((a) => (
                      <ListRow
                        key={a.slug}
                        className={NESTED}
                        size="sm"
                        href={`/agents/${encodeURIComponent(a.slug)}`}
                        active={at("agents", a.slug)}
                        onClick={() => setHeld(p.slug)}
                        innerProps={{ title: a.description || a.name, "data-nested": "agent" }}
                        leading={<span aria-hidden>{a.emoji || "🤖"}</span>}
                        title={<span className="font-medium">{a.name}</span>}
                        titleExtra={<AgentMarks n={attentionFor.agent(waiting, a.slug).length} st={status?.[a.slug]} />}
                      />
                    ))}
                  {/* The apps pinned to the project (its linked vibeables): open beside the project's chat. */}
                  {open &&
                    apps.map((v) => (
                      <ListRow
                        key={`app:${v}`}
                        className={NESTED}
                        size="sm"
                        href={`/projects/${encodeURIComponent(p.slug)}?app=${encodeURIComponent(v)}`}
                        onClick={() => setHeld(p.slug)}
                        innerProps={{ title: `open ${v} beside the project's chat`, "data-nested": "app" }}
                        leading={<Icon name="web" className="ms-sm" />}
                        title={<span className="font-medium">{v}</span>}
                      />
                    ))}
                </Fragment>
              );
            })}
            {fold.all && projectList.length > 0 && (
              <Button variant="quiet" size="sm" icon="expand_more" className="justify-start" onClick={() => setFold((f) => ({ ...f, all: false }))}>
                {projectList.filter((p) => !here(p)).length} more
              </Button>
            )}
          </Group>
        )}

        <Group label="agents" href="/agents" add={expert ? { href: "/agents/new", label: "new agent" } : undefined}>
          {(agents?.agents ?? []).filter((a) => !a.archived).map((a) => {
            const line = statusLine(status?.[a.slug], a.description);
            return (
              <ListRow
                key={a.slug}
                href={`/agents/${encodeURIComponent(a.slug)}`}
                active={at("agents", a.slug) || at("team", a.slug)}
                innerProps={{ title: a.description || undefined }}
                leading={<span aria-hidden>{a.emoji || "🤖"}</span>}
                title={a.name}
                titleExtra={<AgentMarks n={attentionFor.agent(waiting, a.slug).length} st={status?.[a.slug]} />}
                sub={line ? <span className={`rail-status${line.tone === "plain" ? "" : ` ${line.tone}`}`}>{line.text}</span> : undefined}
                subTone={line?.tone === "waiting" ? "bad" : line?.tone === "working" ? "accent" : "plain"}
              />
            );
          })}
        </Group>

        <Group label="channels" href="/channels" add={{ href: "/channels/new", label: "new channel" }}>
          {(channels?.channels ?? []).map((c) => (
            <ListRow
              key={c.slug}
              href={`/channels/${encodeURIComponent(c.slug)}`}
              active={at("channels", c.slug)}
              leading={<span aria-hidden className="font-semibold">#</span>}
              title={c.name}
              titleExtra={
                <>
                  <Badge n={attentionFor.channel(waiting, c.slug).length} title="waiting for you" />
                  {c.busy && !c.awaitingApproval && <Dot tone="working" title="an agent is working" />}
                </>
              }
              sub={c.purpose || (c.members.length ? `with ${c.members.map((m) => `@${m}`).join(" ")}` : "no agents yet")}
            />
          ))}
        </Group>
      </div>
    </nav>
  );
}

/** One level in, on a thread line: an agent or an app under its project. */
const NESTED = "ml-5 rounded-l-none border-l border-line";

/** A group of the rail: its heading (a link to the full page), a "+" to add one, and its rows. */
function Group({
  label,
  href,
  add,
  badge,
  fold,
  children,
}: {
  label: string;
  href: string;
  add?: { href: string; label: string };
  badge?: React.ReactNode;
  fold?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex flex-col gap-0.5" role="group" aria-label={label[0].toUpperCase() + label.slice(1)}>
      <div className="flex items-center gap-1 pl-2.5 pr-1">
        <Link href={href} className="flex-1 px-0 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-accent no-underline hover:underline">
          {label}
        </Link>
        {badge}
        {add && <IconButton size="sm" icon="add" label={add.label} href={add.href} />}
        {fold}
      </div>
      {children}
    </div>
  );
}

/** Beside an agent's name: the red count of what waits for you, or the pulse while it works. */
function AgentMarks({ n, st }: { n: number; st?: AgentStatus }) {
  return (
    <>
      <Badge n={n} title="waiting for you" />
      {!n && st?.working.length && !st.waiting.length ? <Dot tone="working" title="working" /> : null}
    </>
  );
}

const FOLD_KEY = "kw-rail-fold";
interface Fold {
  /** The projects group collapsed to the project you are in. */
  all: boolean;
  /** Per project: its assistant, agents and apps shown (true) or hidden (false); absent = open while it is the project you were last in. */
  open: Record<string, boolean>;
}

/** The rail's folding, remembered per browser. */
function useFold(): [Fold, (f: (prev: Fold) => Fold) => void] {
  const [fold, setFold] = useState<Fold>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "null") as Partial<Fold> | null;
      return { all: !!v?.all, open: v?.open && typeof v.open === "object" ? v.open : {} };
    } catch {
      return { all: false, open: {} };
    }
  });
  const update = (f: (prev: Fold) => Fold) =>
    setFold((prev) => {
      const next = f(prev);
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [fold, update];
}
