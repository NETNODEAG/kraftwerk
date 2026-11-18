import { Fragment, useState } from "react";
import { useApi } from "./api";
import { Elapsed, Icon, Link, LocalNav, fmtAgo, navigate, useFeatures, useHashPath, type Features } from "./shared";
import { PlacesMap, type MapPlace } from "./places-map";
import { EventsCalendar, type CalEvent } from "./events-calendar";
import { BoardGlance, TaskPage, boardHref } from "./boards";
import { DeckGlance } from "./presentations";
import { EntityPage } from "./entities";
import { VibePane } from "./vibeables";
import { WorkflowView, type WorkflowTab } from "./workflow-view";
import { RunDetailView } from "./runs";
import { BundleView } from "./knowledge";
import { RepoPage } from "./repos";
import { SkillView } from "./skills";
import { ChatThread } from "./chat";
import { OpenHere, chatIdOf } from "./chat-card";
import { NEW_KINDS, NewThingModal, type NewKind } from "./new-thing";
import { chatHref, chatOwner } from "./dashboard";
import { NEW_ROUTINE, RoutinePreview, WORKSPACE_ROUTINES, routineWhen, routineWho } from "./routines";
import { Button, cn, Dot, EmptyState, Eyebrow } from "./ui";
import type { EntitiesView, EntityBase } from "./types";

/**
 * Home (#/, once #/artifacts): everything in the workspace, in one stream — chats, workflows,
 * their runs, routines, knowledge, skills, apps (vibeables), presentations, boards, repositories,
 * contacts, places and events, the
 * workspace's and every project's — newest first, like a desktop app's
 * artifacts page. What is going on right now (a run under way or waiting for a
 * decision, a chat whose agent is working or asks for approval) is pinned on
 * top under "Now". The tiles on top, in three groups (what you work with, what
 * came out, what the agents know), are the filter (one kind each, pressed
 * again for everything) and each has a + to make a new one; the search goes
 * by title. A row selects the thing: it shows in the right column (`ArtifactPreview`, #/?open=<key>), whose "open"
 * leads to where it lives. Only the kinds whose feature is on show.
 */
type Kind = "chats" | "workflows" | "runs" | "tasks" | "routines" | "knowledge" | "skills" | "vibeables" | "presentations" | "boards" | "repos" | "contacts" | "places" | "events";

/** The tiles' groups: what you start and steer work with, what the work made, what the agents work from. */
type Group = "create" | "results" | "context";
const GROUPS: { id: Group; label: string }[] = [
  { id: "create", label: "Create" },
  { id: "results", label: "Results" },
  { id: "context", label: "Context" },
];

/** Made in the "new" window a moment ago: shown in the preview before the lists have caught up. */
const justMade = new Set<string>();

/** What the "+" of a kind says when it opens a window. */
const NEW_TITLES: Partial<Record<Kind, string>> = { workflows: "describe a workflow and Ralv makes it", skills: "describe a skill and Ralv makes it", runs: "run a workflow", tasks: "add a task to a board" };

const KINDS: { id: Kind; group: Group; label: string; one: string; icon: string; hue: string; newHref: string; newTitle?: string }[] = [
  // Chats are here to try out: the rail keeps listing them too. A row shows the conversation itself in the right column.
  { id: "chats", group: "create", label: "Chats", one: "Chat", icon: "chat", hue: "#4f46e5", newHref: "/agents/chats", newTitle: "new chat" },
  // Workflows have no form of their own: Ralv (or the CLI) writes them.
  { id: "workflows", group: "create", label: "Workflows", one: "Workflow", icon: "account_tree", hue: "#0e7490", newHref: "/agents/chats", newTitle: "ask Ralv to make a workflow" },
  // Skills, like workflows, are written by Ralv (or by hand, as <skills root>/<name>/SKILL.md); one is used from its page, which starts a chat with its command.
  { id: "skills", group: "create", label: "Skills", one: "Skill", icon: "extension", hue: "#9333ea", newHref: "/agents/chats", newTitle: "ask Ralv to make a skill" },
  // A routine made here is the workspace's own (not an agent's): its form opens in the right column.
  { id: "routines", group: "create", label: "Routines", one: "Routine", icon: "schedule", hue: "#b45309", newHref: `/?kind=routines&open=${encodeURIComponent(`routines:${WORKSPACE_ROUTINES}:${NEW_ROUTINE}`)}` },
  { id: "boards", group: "create", label: "Boards", one: "Board", icon: "view_kanban", hue: "#15803d", newHref: "/boards/new" },
  // A run is started from its workflow: the + leads to them.
  { id: "runs", group: "results", label: "Workflow runs", one: "Workflow run", icon: "play_circle", hue: "#0f766e", newHref: "/?kind=workflows", newTitle: "pick a workflow to run" },
  // A task is added on its board: the + leads to them.
  { id: "tasks", group: "results", label: "Tasks", one: "Task", icon: "task_alt", hue: "#166534", newHref: "/?kind=boards", newTitle: "pick a board to add a task" },
  { id: "presentations", group: "results", label: "Presentations", one: "Slides", icon: "slideshow", hue: "#c2410c", newHref: "/presentations/new" },
  { id: "vibeables", group: "results", label: "Apps", one: "App", icon: "web", hue: "#2563eb", newHref: "/vibeables" },
  { id: "knowledge", group: "context", label: "Knowledge", one: "Knowledge bundle", icon: "menu_book", hue: "#4d7c0f", newHref: "/knowledge/new" },
  { id: "repos", group: "context", label: "Repos", one: "Repository", icon: "source", hue: "#475569", newHref: "/repos", newTitle: "clone a repository" },
  { id: "contacts", group: "context", label: "Contacts", one: "Contact", icon: "person", hue: "#7c3aed", newHref: "/contacts/new" },
  { id: "places", group: "context", label: "Places", one: "Place", icon: "location_on", hue: "#be123c", newHref: "/places/new" },
  { id: "events", group: "context", label: "Events", one: "Event", icon: "event", hue: "#a16207", newHref: "/events/new" },
];

interface Item {
  key: string;
  kind: Kind;
  title: string;
  /** Where it lives, for "open"; absent when it lives right here (a workspace routine). */
  href?: string;
  project?: string;
  updatedAt?: string;
  /** What the row says on the right instead of "Edited …" (a routine: when it fires next). */
  when?: string;
  broken?: boolean;
  /** Going on right now, pinned on top: a run under way, a chat whose agent is working; "waiting" when it needs you. */
  live?: "working" | "waiting";
  /** A run under way: since when, for the ticking time on the row. */
  since?: string;
  /** More about it on the row's second line ("12 concepts"). */
  sub?: string;
  /** A place's coordinates, for the map. */
  lat?: number;
  lng?: number;
  /** An event's dates, for the calendar. */
  start?: string;
  end?: string;
}

const enc = encodeURIComponent;
// Chats, workflows, routines, knowledge and skills are always there; every other kind is a feature that can be off.
const on = (f: Features, k: Kind) => k === "chats" || k === "workflows" || k === "runs" || k === "routines" || k === "knowledge" || k === "skills" || !!f[k === "tasks" ? "boards" : k];
const specOf = (k: Kind) => KINDS.find((x) => x.id === k)!;

type HrefOf = (o: { kind?: Kind | "all"; open?: string }) => string;

/**
 * The page's state in its hash: the kind filtered to (#/?kind=places) and the selected thing (&open=<key>).
 * On a project (#/projects/<slug>) it is that project's page: the same state on the project's route, `project` set.
 */
function useArtifactsQuery(): { kind: Kind | "all"; open?: string; project?: string; href: HrefOf } {
  const hash = useHashPath();
  const [path, qs] = hash.split("?");
  const seg = path.split("/").filter(Boolean);
  const project = seg[0] === "projects" && seg.length === 2 && seg[1] !== "new" ? decodeURIComponent(seg[1]) : undefined;
  const base = project ? `/projects/${enc(project)}` : "/";
  const q = new URLSearchParams(qs ?? "");
  const kind = q.get("kind");
  const href: HrefOf = ({ kind, open }) => {
    const out = new URLSearchParams();
    if (kind && kind !== "all") out.set("kind", kind);
    if (open) out.set("open", open);
    const str = out.toString();
    return str ? `${base}?${str}` : base;
  };
  return { kind: KINDS.some((k) => k.id === kind) ? (kind as Kind) : "all", open: q.get("open") ?? undefined, project, href };
}

/** The kinds a project can hold: what is filed under it (chats, routines, boards, tasks, slides) and what it links to. */
const PROJECT_KINDS = new Set<Kind>(["chats", "routines", "boards", "tasks", "presentations", "runs", "workflows", "knowledge", "vibeables", "repos", "contacts", "places", "events"]);
const LINKED: Partial<Record<Kind, "knowledge" | "vibeables" | "repos" | "workflows" | "contacts" | "places" | "events">> = { knowledge: "knowledge", vibeables: "vibeables", repos: "repos", workflows: "workflows", contacts: "contacts", places: "places", events: "events" };

/**
 * Everything made in the workspace, newest first, with the projects' titles. With `only`, a project's own:
 * what is filed under it, what it links to, and the runs of the workflows it links to (a run names no project).
 */
function useArtifacts(only?: string) {
  const features = useFeatures();
  const chats = useApi("chats.list", {});
  const agents = useApi("agents.list", {}, { interval: 30_000 })?.agents ?? [];
  const wfs = useApi("workflows.list", {}, { interval: 30_000 });
  // Watched closely: a run that starts or ends moves in and out of "Now".
  const runs = useApi("runs.list", {}, { fast: true });
  const know = useApi("knowledge.list", {}, { interval: 30_000 });
  const routines = useApi("routines.list", {}, { interval: 30_000 });
  const skills = useApi("skills.list", {}, { interval: 30_000 });
  const repos = useApi("repos.list", features.repos ? {} : null, { interval: 30_000 });
  const vibes = useApi("vibeables.list", features.vibeables ? {} : null, { interval: 30_000 });
  const decks = useApi("presentations.list", features.presentations ? { query: { all: "1" } } : null, { interval: 30_000 });
  const boards = useApi("boards.list", features.boards ? { query: { all: "1" } } : null, { interval: 30_000 });
  const tasks = useApi("tasks.list", features.boards ? {} : null, { interval: 30_000 });
  const contacts = useApi("contacts.list", features.contacts ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const places = useApi("places.list", features.places ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const events = useApi("events.list", features.events ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 60_000 });
  const projectTitle = (slug?: string) => (slug ? (projects?.projects.find((p) => p.slug === slug)?.title ?? slug) : undefined);

  const items: Item[] = ([
    // Every conversation, a channel's included; whose it is on the second line.
    ...(chats?.chats ?? []).map((c) => ({
      key: `chats:${c.id}`,
      kind: "chats" as const,
      title: c.title || "New chat",
      href: chatHref(c),
      project: c.scope.kind === "project" ? c.scope.slug : c.project,
      updatedAt: c.updatedAt,
      live: c.awaitingApproval ? ("waiting" as const) : c.busy ? ("working" as const) : undefined,
      when: c.awaitingApproval ? "needs approval" : c.busy ? "working" : undefined,
      // The project is on the row already: here only who is talked to.
      sub: c.scope.kind === "project" ? "assistant" : chatOwner({ ...c, project: undefined }, agents, (slug) => slug),
    })),
    ...(wfs?.workflows ?? []).map((w) => ({ key: `workflows:${w.slug}`, kind: "workflows" as const, title: w.name || w.slug, href: `/workflows/${enc(w.slug)}`, updatedAt: w.updatedAt, broken: !!w.error })),
    // Every run of every workflow: named after its workflow, the request on the second line, how it stands on the right.
    ...(runs?.runs ?? []).map((r) => {
      const waiting = !!r.awaitingDecision && r.status !== "ok" && r.status !== "aborted";
      const running = r.status === "running";
      return {
        key: `runs:${r.id}`,
        kind: "runs" as const,
        title: r.workflow ?? "unknown workflow",
        href: `/runs/${enc(r.id)}`,
        updatedAt: r.updatedAt,
        live: waiting ? ("waiting" as const) : running ? ("working" as const) : undefined,
        since: running && !waiting ? r.startedAt : undefined,
        when: waiting ? "decision needed" : running ? (r.currentPhase ?? "running") : r.status === "ok" ? `Ran ${fmtAgo(r.updatedAt)}` : `${r.status === "aborted" ? "Stopped" : "Failed"} ${fmtAgo(r.updatedAt)}`,
        broken: r.status === "failed",
        sub: r.request || undefined,
      };
    }),
    ...(know?.bundles ?? []).map((b) => ({ key: `knowledge:${b.name}`, kind: "knowledge" as const, title: b.name, href: `/knowledge/${enc(b.name)}`, updatedAt: b.updatedAt, sub: `${b.concepts} concept${b.concepts === 1 ? "" : "s"}` })),
    // Every routine: the workspace's own (owner "_") and each agent's; newest run first, the ones that never ran last.
    ...(routines?.routines ?? []).map((r) => ({
      key: `routines:${r.owner}:${r.id}`,
      kind: "routines" as const,
      title: r.name,
      ...(r.owner === WORKSPACE_ROUTINES ? {} : { href: `/agents/${enc(r.owner)}/info` }),
      project: r.project,
      updatedAt: r.lastRunAt,
      when: routineWhen(r),
      broken: !!r.lastError,
      sub: routineWho(r),
    })),
    // The workspace's own skills: its skills root and its .claude/skills, not the personal ~/.claude/skills.
    ...(skills?.skills ?? [])
      .filter((sk) => sk.source === "workspace" || sk.source === "project")
      .map((sk) => ({ key: `skills:${sk.name}`, kind: "skills" as const, title: `/${sk.name}`, href: `/skills/${enc(sk.name)}`, updatedAt: sk.updatedAt, sub: sk.description || undefined })),
    ...(repos?.repos ?? []).map((r) => ({
      key: `repos:${r.slug}`,
      kind: "repos" as const,
      title: r.slug,
      href: `/repos/${enc(r.slug)}`,
      updatedAt: r.updatedAt ?? r.committedAt,
      broken: !!r.error,
      sub: [r.branch, r.dirty ? `${r.dirty} changed` : r.ahead ? `${r.ahead} to push` : r.behind ? `${r.behind} behind` : r.error ? "" : "clean"].filter(Boolean).join(" · "),
    })),
    ...(vibes?.vibeables ?? []).map((v) => ({ key: `vibeables:${v.slug}`, kind: "vibeables" as const, title: v.slug, href: `/vibeables/${enc(v.slug)}`, updatedAt: v.updatedAt, broken: !!v.configError })),
    ...(decks?.presentations ?? []).map((d) => ({
      key: `presentations:${d.project ?? ""}:${d.name}`,
      kind: "presentations" as const,
      title: d.title,
      href: d.project ? `/projects/${enc(d.project)}/presentations/${enc(d.name)}` : `/presentations/${enc(d.name)}`,
      project: d.project,
      updatedAt: d.updatedAt,
      broken: !!d.error,
    })),
    ...(boards?.boards ?? []).map((b) => ({
      key: `boards:${b.project ?? ""}:${b.board}`,
      kind: "boards" as const,
      title: b.title,
      href: b.project ? `/projects/${enc(b.project)}/boards/${enc(b.board)}` : `/boards/${enc(b.board)}`,
      project: b.project,
      updatedAt: b.updatedAt,
      broken: !!b.configError,
    })),
    // Every task of every board: its number, board and column on the second line.
    ...(tasks?.tasks ?? []).map((t) => ({
      key: `tasks:${t.project ?? ""}:${t.board}:${t.slug}`,
      kind: "tasks" as const,
      title: t.title,
      href: `${boardHref({ project: t.project, board: t.board })}/${enc(t.slug)}`,
      project: t.project,
      updatedAt: t.updatedAt,
      broken: !!t.configError,
      sub: [`#${t.number}`, t.boardTitle, t.column].filter(Boolean).join(" · "),
    })),
    ...(
      [
        ["contacts", contacts],
        ["places", places],
        ["events", events],
      ] as const
    ).flatMap(([kind, view]) =>
      (view?.items ?? []).map((e) => {
        const at = e as EntityBase & { lat?: number; lng?: number; start?: string; end?: string };
        return { key: `${kind}:${e.slug}`, kind, title: e.title || e.slug, href: `/${kind}/${enc(e.slug)}`, updatedAt: e.updatedAt, broken: !!e.configError, lat: at.lat, lng: at.lng, start: at.start, end: at.end };
      }),
    ),
  ] as Item[]).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const links = useApi("projects.get", only ? { slug: only } : null, { interval: 30_000 })?.links;
  const linked = (kind: Kind, slug: string) => {
    const lk = LINKED[kind];
    return !!lk && !!links?.[lk]?.some((l) => l.slug === slug);
  };
  const mine = (i: Item): boolean => {
    if (i.project === only) return true;
    if (i.project) return false;
    const slug = i.key.slice(i.kind.length + 1);
    if (i.kind === "runs") return !!links?.workflows.some((l) => i.title === l.slug || slug.endsWith(`-${l.slug}`));
    return linked(i.kind, slug);
  };
  if (only) return { items: items.filter(mine), loading: !chats && !tasks && !decks && !boards && !links, projectTitle: () => undefined };
  const loading = !chats && !wfs && !runs && !routines && !know && !skills && !repos && !vibes && !decks && !boards && !contacts && !places && !events;
  return { items, loading, projectTitle };
}

export function ArtifactsScreen({ title = "Home" }: { title?: string }) {
  const features = useFeatures();
  const { kind: filter, open, project: only, href: artifactsHref } = useArtifactsQuery();
  const kinds = KINDS.filter((k) => on(features, k.id) && (!only || PROJECT_KINDS.has(k.id)));
  // On a project the + makes the thing in the project where there is a way to; the rest lead where they do on Home.
  const at = only ? `/projects/${enc(only)}` : "";
  const newHref = (k: (typeof KINDS)[number]): string => {
    if (!only) return k.newHref;
    if (k.id === "chats") return `${at}/chat/new`;
    if (k.id === "boards" || k.id === "presentations") return `${at}/${k.id}/new`;
    if (k.id === "routines") return artifactsHref({ kind: "routines", open: `routines:${WORKSPACE_ROUTINES}:${NEW_ROUTINE}` });
    if (k.id === "runs") return artifactsHref({ kind: "workflows" });
    if (k.id === "tasks") return artifactsHref({ kind: "boards" });
    return k.newHref;
  };
  // Filtering keeps the selection only when it is of the kind filtered to.
  const setFilter = (kind: Kind | "all") => navigate(artifactsHref({ kind, open: kind === "all" || open?.startsWith(`${kind}:`) ? open : undefined }), { replace: true });
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<NewKind | null>(null);
  // A chat or a run started from the "new" window shows beside the list, like anything picked in it.
  const openHere = (href: string): boolean => {
    const chat = chatIdOf(href);
    const run = /^\/runs\/([^/?]+)$/.exec(href)?.[1];
    if (!chat && !run) return false;
    navigate(artifactsHref({ kind: filter, open: chat ? `chats:${chat}` : `runs:${decodeURIComponent(run!)}` }));
    return true;
  };
  const { items, loading: none, projectTitle } = useArtifacts(only);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (filter === "all" || i.kind === filter) && (!needle || `${i.title} ${projectTitle(i.project) ?? ""}`.toLowerCase().includes(needle)));
  const loading = kinds.length > 0 && none;
  // What is going on right now leads the stream: what waits for you first, then what is working.
  const rank = (i: Item) => (i.live === "waiting" ? 0 : i.live === "working" ? 1 : 2);
  const stream = [...shown].sort((a, b) => rank(a) - rank(b));
  const now = stream.filter((i) => i.live).length;

  return (
    <div className="artifacts-screen mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 pt-8 pb-12 max-[800px]:px-4">
      <h1 className="m-0 text-3xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      {adding && (
        <OpenHere.Provider value={openHere}>
          <NewThingModal kind={adding} project={only} onClose={() => setAdding(null)} onMade={(key) => (justMade.add(key), navigate(artifactsHref({ kind: filter, open: key })))} />
        </OpenHere.Provider>
      )}

      {kinds.length > 0 && (
        // The tiles are the filter: one per kind, pressed again to show everything; the + beside the name makes a new one.
        <section className="flex flex-col gap-4" aria-label="kinds">
          {GROUPS.filter((g) => kinds.some((k) => k.group === g.id)).map((g) => (
          <div key={g.id} role="group" aria-label={g.label} className="flex flex-col gap-2">
          <Eyebrow>{g.label}</Eyebrow>
          <div className="grid grid-cols-6 gap-3 max-[900px]:grid-cols-4 max-[600px]:grid-cols-3">
          {kinds.filter((k) => k.group === g.id).map((k) => {
            const pressed = filter === k.id;
            return (
              // The + sits on the tile's corner, so the name below has the tile's whole width.
              <div key={k.id} className="relative flex flex-col gap-1.5 text-fg">
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`show only ${k.label.toLowerCase()}`}
                  title={pressed ? "show everything" : `show only ${k.label.toLowerCase()}`}
                  className={cn(
                    "grid h-[60px] cursor-pointer place-items-center rounded-2xl outline-offset-2 transition-[filter,box-shadow] hover:brightness-95",
                    pressed && "shadow-[0_0_0_2px_currentColor]",
                    filter !== "all" && !pressed && "opacity-55",
                  )}
                  style={{ background: `color-mix(in srgb, ${k.hue} 20%, var(--color-surface))`, color: k.hue }}
                  onClick={() => setFilter(pressed ? "all" : k.id)}
                >
                  <Icon name={k.icon} className="text-[28px]" />
                </button>
                {NEW_KINDS.has(k.id) ? (
                  // Made in a window over Home: nothing to leave for.
                  <button
                    type="button"
                    aria-label={`new ${k.one.toLowerCase()}`}
                    title={NEW_TITLES[k.id] ?? `new ${k.one.toLowerCase()}`}
                    className="absolute top-1 right-1 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 opacity-70 hover:bg-surface hover:opacity-100"
                    style={{ color: k.hue }}
                    onClick={() => setAdding(k.id as NewKind)}
                  >
                    <Icon name="add" className="ms-sm" />
                  </button>
                ) : (
                  <Link
                    href={newHref(k)}
                    aria-label={`new ${k.one.toLowerCase()}`}
                    title={k.newTitle ?? `new ${k.one.toLowerCase()}`}
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-full no-underline opacity-70 hover:bg-surface hover:opacity-100"
                    style={{ color: k.hue }}
                  >
                    <Icon name="add" className="ms-sm" />
                  </Link>
                )}
                <span className={cn("line-clamp-2 text-center text-xs leading-tight [overflow-wrap:anywhere]", pressed && "font-medium")}>{k.label}</span>
              </div>
            );
          })}
          </div>
          </div>
          ))}
        </section>
      )}

      <div className="-mb-3 flex items-center gap-2">
        <h2 className="m-0 flex-1 text-sm font-normal text-fg-2">{filter === "all" ? "Everything" : specOf(filter).label}</h2>
        {searching ? (
          <input
            autoFocus
            type="search"
            aria-label="search home"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => !q && setSearching(false)}
            className="w-56 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
        ) : (
          <button type="button" aria-label="search home" className="grid size-8 cursor-pointer place-items-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => setSearching(true)}>
            <Icon name="search" />
          </button>
        )}
      </div>

      <section className="flex flex-col" aria-label="everything">
        {kinds.length === 0 && (
          <p className="m-0 py-3 text-sm text-fg-2">
            Nothing to list yet: turn on apps, presentations, boards, contacts, places or events in <Link href="/settings" className="text-accent">settings</Link>.
          </p>
        )}
        {!loading && kinds.length > 0 && shown.length === 0 && <p className="m-0 py-3 text-sm text-fg-2">{needle ? `Nothing matches “${q.trim()}”.` : "Nothing here yet — make something above."}</p>}
        {stream.map((i, n) => {
          const k = specOf(i.kind);
          const project = projectTitle(i.project);
          // "Now" over what is going on, "Earlier" where the rest begins.
          const head = now === 0 ? undefined : n === 0 ? "Now" : n === now ? "Earlier" : undefined;
          return (
            // A row selects; the preview on the right opens it where it lives.
            <Fragment key={i.key}>
            {head && <Eyebrow className={cn("block px-2 pb-1", n > 0 && "pt-4")}>{head}</Eyebrow>}
            <Link
              data-live={i.live}
              href={artifactsHref({ kind: filter, open: i.key })}
              data-artifact={i.kind}
              data-key={i.key}
              aria-current={open === i.key ? "true" : undefined}
              className="artifact-row flex items-center gap-3 rounded-xl px-2 py-2.5 text-fg no-underline hover:bg-surface-2 aria-[current=true]:bg-surface-2"
            >
              <span className="grid size-9 flex-none place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${k.hue} 16%, var(--color-surface))`, color: k.hue }} title={k.one}>
                <Icon name={k.icon} className="ms-sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-[15px]", i.broken && "text-on-bad-soft")}>{i.title}</span>
                <span className="truncate text-xs text-fg-2">
                  {k.one}
                  {i.sub ? ` · ${i.sub}` : ""}
                  {project ? ` · 📁 ${project}` : ""}
                  {i.broken && i.kind !== "runs" ? (i.kind === "routines" ? " · last run failed" : " · unreadable") : ""}
                </span>
              </span>
              {i.live ? (
                <span className={cn("flex flex-none items-center gap-1.5 text-sm tabular-nums", i.live === "waiting" ? "text-accent" : "text-fg-2")}>
                  <Dot tone={i.live === "waiting" ? "ask" : "working"} />
                  {i.when}
                  {i.since && <Elapsed since={i.since} />}
                </span>
              ) : i.when ? (
                <span className="flex-none text-sm text-fg-2 tabular-nums" title={i.kind === "routines" ? (i.updatedAt ? `last run ${i.updatedAt}` : "never ran") : i.updatedAt}>
                  {i.when}
                </span>
              ) : (
                i.updatedAt && (
                  <span className="flex-none text-sm text-fg-2 tabular-nums" title={i.updatedAt}>
                    Edited {fmtAgo(i.updatedAt)}
                  </span>
                )
              )}
            </Link>
            </Fragment>
          );
        })}
      </section>
    </div>
  );
}

/**
 * The right column of Home: the selected artifact itself — a deck's
 * slides, an app running, a board's columns, a contact, place or event to
 * edit — under its name, with "open" to where it lives and a close back to
 * the list. Places (filtered to, or one selected) are on an OpenStreetMap
 * map, all of them; a selected one is zoomed to with its details under the
 * map, and a dot on the map selects its place. Events the same way on a
 * dense month calendar: the overview while filtered to them, the selected
 * one's month and details under it. Nothing selected: a hint.
 */
export function ArtifactPreview() {
  const { kind, open, project: only, href: artifactsHref } = useArtifactsQuery();
  const { items, loading } = useArtifacts(only);
  // "+ routine": nothing to find yet — the form for a new one.
  const NEW_KEY = `routines:${WORKSPACE_ROUTINES}:${NEW_ROUTINE}`;
  // A chat or a run started a moment ago (from a skill, a task, a workflow in this column) is not in the list yet: it shows all the same.
  const fresh = (): Item | undefined => {
    if (!open) return undefined;
    if (open.startsWith("chats:")) return { key: open, kind: "chats", title: "New chat" };
    if (open.startsWith("runs:")) return { key: open, kind: "runs", title: "Workflow run" };
    const made = justMade.has(open) ? KINDS.find((x) => open.startsWith(`${x.id}:`)) : undefined;
    return made ? { key: open, kind: made.id, title: `New ${made.one.toLowerCase()}` } : undefined;
  };
  const item: Item | undefined = open === NEW_KEY ? { key: NEW_KEY, kind: "routines", title: "New routine" } : open ? (items.find((i) => i.key === open) ?? fresh()) : undefined;
  // What is started from the thing shown here takes its place in the column; the list stays.
  const openHere = (href: string): boolean => {
    const chat = chatIdOf(href);
    const run = /^\/runs\/([^/?]+)$/.exec(href)?.[1];
    if (!chat && !run) return false;
    navigate(artifactsHref({ kind, open: chat ? `chats:${chat}` : `runs:${decodeURIComponent(run!)}` }));
    return true;
  };
  const k = item ? specOf(item.kind) : undefined;
  const [, a = "", b = "", c = ""] = (open ?? "").split(":");
  const mapped = kind === "places" || item?.kind === "places";
  const places = items.filter((i) => i.kind === "places");
  const pins: MapPlace[] = places.flatMap((p) => (p.lat !== undefined && p.lng !== undefined ? [{ slug: p.key.slice("places:".length), title: p.title, lat: p.lat, lng: p.lng }] : []));
  const unmapped = places.length - pins.length;
  const close = artifactsHref({ kind });
  const dated = kind === "events" || item?.kind === "events";
  const cal: CalEvent[] = items.flatMap((i) => (i.kind === "events" && i.start ? [{ slug: i.key.slice("events:".length), title: i.title, start: String(i.start), end: i.end ? String(i.end) : undefined }] : []));
  const head = item && k && (
    <div className="flex flex-none items-center gap-2.5 border-b border-line px-3 py-2.5">
      <span className="grid size-8 flex-none place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${k.hue} 16%, var(--color-surface))`, color: k.hue }} title={k.one}>
        <Icon name={k.icon} className="ms-sm" />
      </span>
      <h2 className="m-0 min-w-0 flex-1 truncate text-base font-semibold text-fg" title={item.title}>
        {item.title}
      </h2>
      {item.href && (
        <Button variant="quiet" size="sm" icon="open_in_new" href={item.href} title={`open the ${k.one.toLowerCase()} where it lives`}>
          open
        </Button>
      )}
      <Button variant="quiet" size="sm" icon="close" href={close} aria-label="close the preview" />
    </div>
  );
  return (
    <>
      <div className="space-title flex min-w-0 items-center gap-2 px-1" />
      <aside className="ctx artifact-preview" aria-label="Preview" data-open={item?.key}>
        {dated ? (
          <>
            {head}
            <div className={cn("flex min-h-0 flex-col p-3", item ? "h-[52%] flex-none" : "flex-1")}>
              <EventsCalendar events={cal} selected={item ? a : undefined} onPick={(slug) => navigate(artifactsHref({ kind, open: `events:${slug}` }))} />
            </div>
            {item ? (
              <div key={item.key} className="ctx-body ctx-embed border-t border-line">
                <EntityPage kind="events" slug={a} />
              </div>
            ) : (
              <p className="m-0 flex-none px-3 pb-3 text-sm text-fg-2">Pick an event on the left or in the calendar to see its details.</p>
            )}
          </>
        ) : mapped ? (
          <>
            {head}
            <div className={cn("flex min-h-0 flex-col gap-1.5 p-3", item ? "h-[48%] flex-none" : "flex-1")}>
              <PlacesMap places={pins} selected={item ? a : undefined} onPick={(slug) => navigate(artifactsHref({ kind, open: `places:${slug}` }))} />
              {(unmapped > 0 || (item && item.lat === undefined)) && (
                <p className="m-0 text-xs text-fg-2">
                  {item && item.lat === undefined ? "This place has no coordinates yet: add latitude and longitude below to put it on the map." : `${unmapped} of ${places.length} places have no coordinates and are not on the map.`}
                </p>
              )}
            </div>
            {item ? (
              <div key={item.key} className="ctx-body ctx-embed border-t border-line">
                <EntityPage kind="places" slug={a} />
              </div>
            ) : (
              <p className="m-0 flex-none px-3 pb-3 text-sm text-fg-2">Pick a place on the left or a dot on the map to zoom in and see its details.</p>
            )}
          </>
        ) : !item || !k ? (
          <EmptyState icon="preview" className="my-auto">
            {open && !loading ? "That one is gone." : "Pick something on the left to see it here."}
          </EmptyState>
        ) : (
          <>
            {head}
            {item.kind === "chats" ? (
              // The conversation itself, composer included: it fills the column and scrolls on its own.
              // The thread is laid out for a column with 20px at its sides (its bands bleed into that), so the column gives it.
              <div className="artifact-chat flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-3">
                <ChatThread key={item.key} id={a} />
              </div>
            ) : item.kind === "vibeables" ? (
              <div className="ctx-body ctx-embed ctx-embed-vibe">
                <VibePane key={item.key} slug={a} />
              </div>
            ) : (
              <div key={item.key} className="ctx-body ctx-embed">
                <OpenHere.Provider value={openHere}>
                {item.kind === "workflows" && <WorkflowPreview slug={a} />}
                {item.kind === "runs" && <div className="p-3"><RunDetailView id={a} /></div>}
                {item.kind === "routines" && <RoutinePreview owner={a} id={b} onOpen={(key) => navigate(artifactsHref({ kind, open: key }), { replace: true })} />}
                {item.kind === "knowledge" && <BundlePreview name={a} />}
                {item.kind === "skills" && <SkillView name={a} />}
                {item.kind === "repos" && <RepoPage slug={a} embedded />}
                {item.kind === "presentations" && <DeckGlance project={a || undefined} name={b} />}
                {item.kind === "boards" && <BoardPreview project={a || undefined} board={b} kind={kind} href={artifactsHref} />}
                {item.kind === "tasks" && <div className="p-3"><TaskPage project={a || undefined} board={b} task={c} /></div>}
                {item.kind === "contacts" && <EntityPage kind={item.kind} slug={a} />}
                </OpenHere.Provider>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

/** A workflow in the preview: its own view (request box, board, details, runs), its tab links kept in the column. */
function WorkflowPreview({ slug }: { slug: string }) {
  const [tab, setTab] = useState<WorkflowTab>("overview");
  const base = `/workflows/${enc(slug)}`;
  const take = (href: string) => {
    if (href !== base && !href.startsWith(`${base}/`)) return false;
    const t = href.slice(base.length + 1);
    setTab(t === "details" || t === "runs" ? t : "overview");
    return true;
  };
  return (
    <LocalNav.Provider value={take}>
      <WorkflowView key={slug} slug={slug} tab={tab} />
    </LocalNav.Provider>
  );
}

/** A board in the preview: its columns at a glance; a task's link opens the task right here, in the column. */
function BoardPreview({ project, board, kind, href: artifactsHref }: { project?: string; board: string; kind: Kind | "all"; href: HrefOf }) {
  const base = `${boardHref({ project, board })}/`;
  const take = (href: string) => {
    const task = href.startsWith(base) ? href.slice(base.length) : "";
    if (!task || task.includes("/") || task === "settings") return false;
    navigate(artifactsHref({ kind: kind === "boards" ? "all" : kind, open: `tasks:${project ?? ""}:${board}:${decodeURIComponent(task)}` }));
    return true;
  };
  return (
    <LocalNav.Provider value={take}>
      <BoardGlance project={project} board={board} />
    </LocalNav.Provider>
  );
}

/** A knowledge bundle in the preview: its own view, a concept link opening the concept in the column. */
function BundlePreview({ name }: { name: string }) {
  const [concept, setConcept] = useState<string | undefined>(undefined);
  const base = `/knowledge/${enc(name)}`;
  const take = (href: string) => {
    if (href !== base && !href.startsWith(`${base}/`)) return false;
    const rest = href.slice(base.length + 1);
    setConcept(rest ? rest.split("/").map(decodeURIComponent).join("/") : undefined);
    return true;
  };
  return (
    <LocalNav.Provider value={take}>
      <BundleView key={name} name={name} conceptId={concept} />
    </LocalNav.Provider>
  );
}
