import { Fragment, useEffect, useState } from "react";
import { statusLine } from "../../src/core/status-line";
import { attentionFor, useAttention } from "./attention";
import { api, useApi } from "./api";
import { Icon, Link, PROJECT_ASSISTANT, useExpertMode, useFeatures } from "./shared";
import { SortableProjects, freshSectionName } from "./rail-sort";
import { Badge, Button, Dot, IconButton, ListRow } from "./ui";
import type { Agent, AgentStatus, ChannelView, ProjectLayout, ProjectsView, VibeablesView } from "./types";

/**
 * The first column: who can be talked to. The general chat, every project,
 * every agent and every channel, each a link into the conversation routes
 * the screens already answer. It replaces the roster sidebars those screens
 * carry on wide windows (shell.css hides them there).
 */
export function ConversationsRail({ chatPath }: { chatPath: string }) {
  const features = useFeatures();
  const expert = useExpertMode();
  const agents = useApi("agents.list", {}, { interval: 15_000 });
  const channels = useApi("channels.list", {}, { interval: 6000 });
  // A pin, an unpin or a new order arrives pushed, like any other change.
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 15_000 });
  const status = useApi("agents.status", {}, { interval: 5000 });
  const vibes = useApi("vibeables.list", features.vibeables ? {} : null, { interval: 15_000 });
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
  const projectBySlug = new Map(projectList.map((p) => [p.slug, p]));
  const ordered = projects?.layout
    ? [...projects.layout.top, ...projects.layout.sections.flatMap((x) => x.projects)].map((slug) => projectBySlug.get(slug)).filter((p): p is (typeof projectList)[number] => !!p)
    : projectList;
  // The order and sections are the workspace's (order.yml); saving refetches the list at once.
  const saveLayout = async (layout: ProjectLayout): Promise<boolean> => {
    const r = await api.request("projects.saveLayout", { body: layout }).catch(() => null);
    return !!r?.ok;
  };
  const [newSection, setNewSection] = useState<string>();
  const addSection = async () => {
    if (!projects?.layout) return;
    const name = freshSectionName(projects.layout);
    if (await saveLayout({ ...projects.layout, sections: [...projects.layout.sections, { name, projects: [] }] })) setNewSection(name);
  };

  /** One project's rows: its own and, open, its assistant, agents and apps. */
  const renderProject = (p: (typeof projectList)[number]) => {
    const team = teamOf(p);
    const apps = features.vibeables ? (p.vibeables ?? []).filter((v) => vibeSlugs.has(v)) : [];
    // Open: as its chevron left it; untouched, the project you were last in. Every project
    // has its assistant under it, so every project folds.
    const open = fold.open[p.slug] ?? p.slug === (inProject ?? held);
    const busy = team.map((a) => status?.[a.slug]).filter((s): s is AgentStatus => !!s);
    const working = !open && busy.some((s) => s.working.length && !s.waiting.length);
    return (
      <>
        <ListRow
          size="sm"
          href={`/projects/${encodeURIComponent(p.slug)}`}
          // Open, the assistant row below is where you are; folded, the project row says it.
          active={at("projects", p.slug) && !open}
          innerProps={{ "data-project": p.slug, title: p.goal ? `${p.title}: ${p.goal}` : p.title }}
          leading={<span aria-hidden>{p.status === "done" ? "✅" : p.status === "paused" ? "⏸️" : p.status === "archived" ? "🗄️" : "📁"}</span>}
          title={p.title}
          titleExtra={
            <>
              <Badge n={attentionFor.project(waiting, p.slug, p.agents).length} title="waiting for you" />
              {working && <Dot tone="working" title="an agent is working" />}
            </>
          }
          // The title only, on up to two lines; the goal is a tooltip here and leads the context column's overview.
          titleLines={2}
          // The chevron shows on hover, and always on the open project.
          actionsAlways={open}
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
      </>
    );
  };

  return (
    <nav className="rail" aria-label="Conversations">
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-4">
        <ListRow
          href="/"
          active={chatPath === "/"}
          leading={<Icon name="home" />}
          title="Home"
          innerProps={{ title: "Today: what needs you, what happened" }}
        />
        <ListRow
          href="/agents/chats"
          active={general}
          leading={<span aria-hidden>🎩</span>}
          title="Ralv"
          titleExtra={<Badge n={attentionFor.general(waiting).length} title="waiting for you" />}
          innerProps={{ title: "Chief of staff: knows the workspace, advises, launches things" }}
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
                <>
                  {!fold.all && projects?.layout && (
                    <IconButton size="sm" icon="create_new_folder" label="new section" title="new section: drag projects into it" onClick={() => void addSection()} />
                  )}
                  <IconButton
                    size="sm"
                    icon={fold.all ? "chevron_right" : "expand_more"}
                    label={fold.all ? "show all projects" : "collapse projects"}
                    aria-expanded={!fold.all}
                    onClick={() => setFold((f) => ({ ...f, all: !f.all }))}
                  />
                </>
              ) : undefined
            }
          >
            {/* Collapsed, the group keeps only the project you are in; open, the projects in their order and sections. */}
            {fold.all || !projects?.layout ? (
              ordered.filter((p) => !fold.all || here(p)).map((p) => <Fragment key={p.slug}>{renderProject(p)}</Fragment>)
            ) : (
              <SortableProjects
                layout={projects.layout}
                visible={(slug) => !!projectBySlug.get(slug) && here(projectBySlug.get(slug)!)}
                render={(slug) => (projectBySlug.get(slug) ? renderProject(projectBySlug.get(slug)!) : null)}
                onSave={saveLayout}
                collapsed={(name) => !!fold.sections[name]}
                onCollapse={(name) => setFold((f) => ({ ...f, sections: { ...f.sections, [name]: !f.sections[name] } }))}
                editing={newSection}
                onEdited={() => setNewSection(undefined)}
              />
            )}
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
      <div className="group/head flex items-center gap-1 pl-2.5 pr-1">
        <Link href={href} className="flex-1 px-0 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-fg-2 no-underline hover:text-fg">
          {label}
        </Link>
        {badge}
        {/* The group's own controls show on hover (always on a touch screen, which has none). */}
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-within/head:opacity-100 pointer-coarse:opacity-100">
          {add && <IconButton size="sm" icon="add" label={add.label} href={add.href} />}
          {fold}
        </span>
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
  /** Per section (by name): folded away, the project you are in excepted. */
  sections: Record<string, boolean>;
  /** Per project: its assistant, agents and apps shown (true) or hidden (false); absent = open while it is the project you were last in. */
  open: Record<string, boolean>;
}

/** The rail's folding, remembered per browser. */
function useFold(): [Fold, (f: (prev: Fold) => Fold) => void] {
  const [fold, setFold] = useState<Fold>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "null") as Partial<Fold> | null;
      const obj = <T,>(x: T | undefined): T | Record<string, never> => (x && typeof x === "object" ? x : {});
      return { all: !!v?.all, open: obj(v?.open), sections: obj(v?.sections) };
    } catch {
      return { all: false, open: {}, sections: {} };
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
