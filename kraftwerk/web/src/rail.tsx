import { Fragment, useState } from "react";
import { statusLine } from "../../src/core/status-line";
import { attentionFor, useAttention } from "./attention";
import { api, useApi } from "./api";
import { Icon, Link, useExpertMode, useFeatures } from "./shared";
import { SortableProjects, freshSectionName } from "./rail-sort";
import { Badge, Button, Dot, IconButton, ListRow } from "./ui";
import type { Agent, AgentStatus, ProjectLayout, ProjectsView } from "./types";

/**
 * The first column: who can be talked to. The general chat, every project,
 * every agent, each a link into the conversation routes
 * the screens already answer. It replaces the roster sidebars those screens
 * carry on wide windows (shell.css hides them there).
 */
export function ConversationsRail({ chatPath }: { chatPath: string }) {
  const features = useFeatures();
  const expert = useExpertMode();
  const agents = useApi("agents.list", {}, { interval: 15_000 });
  // A pin, an unpin or a new order arrives pushed, like any other change.
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 15_000 });
  const status = useApi("agents.status", {}, { interval: 5000 });
  const seg = chatPath.split("/").filter(Boolean);
  const at = (kind: string, slug?: string) =>
    seg[0] === kind && (slug === undefined || (seg[1] ? decodeURIComponent(seg[1]) : undefined) === slug);
  const general = seg[0] === "agents" && seg[1] === "chats";
  const [fold, setFold] = useFold();
  // What waits for you, counted on every row that leads there.
  const waiting = useAttention() ?? [];
  const agentBySlug = new Map((agents?.agents ?? []).filter((a) => !a.archived).map((a) => [a.slug, a]));

  const projectList = projects?.projects ?? [];
  const teamOf = (p: ProjectsView["projects"][number]) =>
    (p.agents ?? []).map((slug) => agentBySlug.get(slug)).filter((a): a is Agent => !!a);
  // Where you are: in the project.
  const here = (p: ProjectsView["projects"][number]) => at("projects", p.slug);
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

  /** One project's row: no sublinks; its agents are in the session picker, its apps, boards and decks in the project's overview and context. */
  const renderProject = (p: (typeof projectList)[number]) => {
    const busy = teamOf(p).map((a) => status?.[a.slug]).filter((s): s is AgentStatus => !!s);
    const working = busy.some((s) => s.working.length && !s.waiting.length);
    return (
      <ListRow
        size="sm"
        href={`/projects/${encodeURIComponent(p.slug)}`}
        active={at("projects", p.slug)}
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
      />
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
          leading={<Icon name="chat" />}
          title="Chats"
          titleExtra={<Badge n={attentionFor.general(waiting).length} title="waiting for you" />}
          innerProps={{ title: "Every chat with Ralv and in the projects; start a new one with Ralv, the chief of staff" }}
        />
        <ListRow
          href="/artifacts"
          active={chatPath === "/artifacts"}
          leading={<Icon name="category" />}
          title="Artifacts"
          innerProps={{ title: "Everything made here: apps, presentations, boards, contacts, places, events" }}
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
      </div>
    </nav>
  );
}

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
  /** Unused since projects have no sublinks; kept so stored values still parse. */
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
