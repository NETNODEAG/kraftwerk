import { ArtifactsScreen } from "./artifacts";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  ChatAgentId,
  ChatMeta,
  LinkState,
  ProjectDetail,
  ProjectStatus,
  ProjectsView,
  SystemOfRecord,
} from "./types";
import { api, failure, useApi } from "./api";
import { ChatThread } from "./chat";
import { EFFORTS, Icon, Link, navigate, fmtAgo, PROJECT_ASSISTANT, useFeatures } from "./shared";
import { SessionHome, createSession } from "./session-home";
import { Avatar, Button, Dot, EmptyState, Field, FieldRow, FormStack, Hint, IconButton, ListRow, Notice, Page, Panel, PanelRow, PanelRows, Select, SideHead, SideList, SideNote, Tag, TextArea, TextField, Title, type DotTone } from "./ui";

/**
 * Projects: a goal with everything the agents need to reach it in one
 * folder (kraftwerk-data/projects/<slug>/): brief, systems of record,
 * links to knowledge, vibeables, repositories, workflows and agents.
 * Working in a project is chat. The project's overview starts sessions and
 * lists the recent ones; an open session is named next to the project's
 * title above it (context-panel.tsx), which leads back to the overview.
 * Routes:
 *   #/projects                       latest project (or the create form)
 *   #/projects/new                   create form
 *   #/projects/<slug>                the overview: a new session (assistant or an agent) and the recent ones
 *   #/projects/<slug>/chat/<chatId>  one chat thread
 *   #/projects/<slug>/info           the project page
 *   #/projects/<slug>/boards/…       the project's boards — a page of its own (app.tsx mounts boards.tsx there)
 */

const STATUSES: ProjectStatus[] = ["active", "paused", "done", "archived"];
const STATUS_DOT: Record<ProjectStatus, DotTone> = { active: "working", paused: "idle", done: "ok", archived: "idle" };

const RECORD_KINDS: Record<string, string> = {
  "my-netnode": "my.netnode.ch",
  "google-drive": "Google Drive",
  github: "GitHub",
  bitbucket: "Bitbucket",
  notion: "Notion",
  slack: "Slack",
  crm: "CRM",
  newsletter: "Newsletter tool",
  calendar: "Calendar",
  "google-maps": "Google Maps",
  url: "Link",
};
const kindLabel = (kind: string): string => RECORD_KINDS[kind] ?? kind;

const HARNESSES: Array<{ id: ChatAgentId; label: string; hint: string }> = [
  { id: "claude", label: "claude", hint: "Claude Code via ACP" },
  { id: "codex", label: "codex", hint: "Codex (ChatGPT) via ACP" },
  { id: "pi", label: "pi", hint: "pi coding agent" },
  { id: "antigravity", label: "antigravity", hint: "Google Antigravity (agy) via ACP" },
];

/** "claude · sonnet · effort high" — what a project's chats run on. */
const runsOn = (p: { harness: ChatAgentId; model?: string; effort?: string }): string =>
  [p.harness, p.model, p.effort ? `effort ${p.effort}` : ""].filter(Boolean).join(" · ");

type ProjectChat = ChatMeta & { busy: boolean; awaitingApproval?: boolean };
/** The project's own chats, plus the channels that started as one of them and the agents' chats filed under it (meta.project). */
const chatsOf = (chats: ProjectChat[] | undefined, slug: string): ProjectChat[] =>
  (chats ?? []).filter((c) => (c.scope.kind === "project" && c.scope.slug === slug) || c.project === slug);
/** Every chat of a project opens here — a channel session too; it just renders in channel mode. */
const chatHref = (c: ProjectChat, slug: string): string => `/projects/${encodeURIComponent(slug)}/chat/${c.id}`;

async function putProject(slug: string, patch: Record<string, unknown>, keepalive = false): Promise<ProjectDetail> {
  const r = await api.request("projects.save", { slug, body: patch, keepalive });
  if (!r.ok) throw new Error(failure(r));
  return r.data;
}

export function ProjectsScreen({ seg }: { seg: string[] }) {
  // seg (after /projects): [] | [new] | [slug] | [slug, info] | [slug, chat, chatId]
  const slug = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const mode = seg[0] === "new" ? "new" : seg[1] === "info" ? "info" : seg[1] === "chat" ? "chat" : slug ? "project" : "home";
  const chatId = mode === "chat" ? seg[2] : undefined;

  const [view, setView] = useState<ProjectsView | null>(null);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    try {
      const r = await api.request("projects.list");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView(r.data);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "could not load projects");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await reload();
      if (alive) timer = setTimeout(tick, 15_000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reload]);

  // Route changes refetch, so a project created or removed elsewhere shows up now.
  useEffect(() => {
    void reload();
  }, [slug, mode, reload]);

  const projects = view?.projects ?? [];
  const current = slug ? projects.find((p) => p.slug === slug) : undefined;

  // A bare #/projects lands on the project changed last.
  const latest = [...projects].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0]?.slug;
  useEffect(() => {
    if (mode === "home" && latest) navigate(`/projects/${encodeURIComponent(latest)}`, { replace: true });
  }, [mode, latest]);

  let main: React.ReactNode;
  if (view && !view.enabled)
    main = (
      <EmptyState icon="folder_off">
        {view.error && !/are off/.test(view.error) ? (
          <span className="text-bad">{view.error}</span>
        ) : (
          <>
            Projects are off. Turn them on in <a href="#/settings">settings</a> or add a <code>projects:</code> block to kraftwerk.yml.
          </>
        )}
      </EmptyState>
    );
  else if (!view) main = <EmptyState>loading…</EmptyState>;
  else if (mode === "new" || (mode === "home" && projects.length === 0)) main = <NewProject root={view.root} onCreated={reload} />;
  else if (mode === "home") main = <EmptyState>loading…</EmptyState>;
  else if (slug && !current) main = <EmptyState icon="folder_off">no project named {slug}</EmptyState>;
  else if (mode === "chat" && slug && chatId === "new") main = <ProjectHome key={slug} slug={slug} title={current?.title ?? slug} />;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ProjectChatMain key={chatId} chatId={chatId} title={current?.title ?? slug} goal={current?.goal} />
      </div>
    );
  else if (mode === "info" && slug) main = <ProjectPage key={slug} slug={slug} onChanged={reload} />;
  // The project's own Home: everything in it, the same stream as #/. A new session starts at /chat/new.
  else if (slug) main = <ArtifactsScreen key={slug} title={current?.title ?? slug} />;
  else main = <EmptyState>loading…</EmptyState>;

  return (
    <div className={`runs-screen agents-screen projects-screen ${slug && current ? "in-project" : ""}`}>
      <aside className="runs-side">
        <SideHead
          title="projects"
          count={view?.enabled ? projects.length : undefined}
          action={
            view?.enabled && (
              <Button size="sm" variant="quiet" icon="add" href="/projects/new">
                new
              </Button>
            )
          }
        />
        <SideList>
          {projects.map((p) => (
            <ListRow
              key={p.slug}
              href={`/projects/${encodeURIComponent(p.slug)}`}
              active={p.slug === slug}
              size="sm"
              innerProps={{ "data-project": p.slug }}
              leading={<Dot tone={p.configError ? "bad" : STATUS_DOT[p.status]} title={p.status} />}
              title={p.title}
              sub={p.configError ? p.configError : p.goal || p.status}
              subTone={p.configError ? "bad" : "plain"}
              meta={p.updatedAt && <span title={p.updatedAt}>{fmtAgo(p.updatedAt)}</span>}
            />
          ))}
          {view && view.enabled && projects.length === 0 && <SideNote>no projects yet</SideNote>}
          {loadError && <Notice tone="bad">{loadError}</Notice>}
        </SideList>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}

/* ---------- create ---------- */

/** The create form on its own (the modal over a conversation): reads the root it will write to. */
export function NewProjectPage() {
  const view = useApi("projects.list", {}, { interval: 60_000 });
  if (view && !view.enabled) return <EmptyState icon="folder_off">Projects are off. Turn them on in <a href="#/settings">settings</a>.</EmptyState>;
  return <NewProject root={view?.root} onCreated={async () => {}} />;
}

function NewProject({ root, onCreated }: { root?: string; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.request("projects.create", { body: { title: t, goal: goal.trim() } });
      if (!r.ok) throw new Error(failure(r));
      const d = r.data;
      // Navigate before the list refreshes: the bare-projects redirect fires
      // once the list has a project, and must not race this route change.
      navigate(`/projects/${encodeURIComponent(d.slug)}/info`);
      void onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-chat mx-auto flex w-full max-w-[640px] animate-rise flex-col gap-4" onSubmit={(e) => void create(e)}>
      <Title size="lg">new project</Title>
      <Panel>
        <FormStack className="max-w-[680px]">
          <Field label="title">
            <TextField value={title} placeholder="e.g. Relaunch netnode.ch" aria-label="project title" autoFocus onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="goal (one line)">
            <TextField value={goal} placeholder="e.g. Ship the new site on NodeHive by November" aria-label="project goal" onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" type="submit" icon="add" busy={busy} disabled={!title.trim()}>
              {busy ? "creating…" : "create project"}
            </Button>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <Hint>
            One folder each under <code title={root}>{root}</code> with project.yml, brief.md, state.md and log.md; part of the workspace, commit it from
            the git screen. Chats opened in the project carry all of it as context.
          </Hint>
        </FormStack>
      </Panel>
    </form>
  );
}

/* ---------- overview: new session + recents ---------- */

/** Who a new session is with: the project's assistant ("") or an agent's slug. */
/**
 * A bare #/projects/<slug>: the project's overview (`SessionHome`): a composer
 * that starts a session with the project's assistant or with any agent, filed
 * under the project; the apps pinned to it; the recent sessions. The context
 * column beside it stays the project's.
 */
function ProjectHome({ slug, title }: { slug: string; title: string }) {
  const features = useFeatures();
  const project = useApi("projects.get", { slug });
  const chats = useApi("chats.list", {});
  const harness = HARNESSES.find((h) => h.id === project?.harness) ?? HARNESSES[0];
  // The apps pinned to the project (its linked vibeables), between the composer and the recents.
  const apps = features.vibeables ? (project?.links.vibeables ?? []).filter((l) => l.found).map((l) => l.slug) : [];
  const href = (id: string) => `/projects/${encodeURIComponent(slug)}/chat/${id}`;
  return (
    <SessionHome
      placeholder={`New session in ${title}`}
      byDefault={{
        ...PROJECT_ASSISTANT,
        sub: project ? `the project's assistant · ${runsOn(project)}` : "the project's assistant",
        hint: project ? runsOn(project) : "",
      }}
      // The project's agents first, then everyone else: any agent can work in the project's context.
      firstGroup={{ label: "agents of the project", slugs: new Set((project?.links.agents ?? []).map((l) => l.slug)) }}
      agentHint="works with the project's context"
      sessions={chats ? chatsOf(chats.chats, slug) : null}
      hrefOf={(c) => chatHref(c, slug)}
      create={(agent) =>
        createSession(agent ? { agent: "claude", scope: { kind: "agent", slug: agent }, project: slug } : { agent: harness.id, scope: { kind: "project", slug } }, href)
      }
    >
      {apps.length > 0 && (
        <section className="flex flex-col gap-1" aria-label="pinned apps">
          <h2 className="m-0 px-3 pb-1 text-sm font-medium text-fg-2">Apps</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 px-1">
            {apps.map((v) => (
              <Link
                key={v}
                href={`/projects/${encodeURIComponent(slug)}?app=${encodeURIComponent(v)}`}
                className="pinned-app flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg no-underline hover:bg-surface-2"
                title={`open ${v} beside the project's chat`}
                data-app={v}
              >
                <Icon name="web" className="ms-sm text-fg-2" />
                <span className="min-w-0 truncate font-medium">{v}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </SessionHome>
  );
}

/**
 * One chat of the project. A plain project chat is the project assistant's
 * thread; after "add coworker" the same chat is a channel session and
 * renders in channel mode (members, @mentions) without leaving the
 * project — the channel definition and the agents come from the API.
 */
function ProjectChatMain({ chatId, title, goal }: { chatId: string; title: string; goal?: string }) {
  const [scope, setScope] = useState<ChatMeta["scope"] | null>(null);
  const [gone, setGone] = useState(false);
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .call("chats.get", { id: chatId })
      .then((d) => alive && setScope(d.meta.scope))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [chatId, gen]);
  const channelSlug = scope?.kind === "channel" ? scope.slug : undefined;
  const agentSlug = scope?.kind === "agent" ? scope.slug : undefined;
  const channels = useApi("channels.list", channelSlug ? {} : null, { interval: 4000 });
  const agents = useApi("agents.list", channelSlug || agentSlug ? {} : null, { interval: 8000 });
  if (gone) return <EmptyState icon="chat_error">chat not found</EmptyState>;
  if (!scope) return <EmptyState>loading…</EmptyState>;
  if (channelSlug) {
    const channel = channels?.channels.find((c) => c.slug === channelSlug);
    if (!channels) return <EmptyState>loading…</EmptyState>;
    if (!channel) return <EmptyState icon="forum">channel #{channelSlug} is gone — its definition under channels/ was removed</EmptyState>;
    return <ChatThread key={`${chatId}:channel`} id={chatId} channel={channel} agents={agents?.agents ?? []} />;
  }
  if (agentSlug) {
    // An agent's chat filed under the project: the agent speaks, the project is around it.
    const a = agents?.agents.find((x) => x.slug === agentSlug);
    if (!agents) return <EmptyState>loading…</EmptyState>;
    return <ChatThread key={`${chatId}:${gen}`} id={chatId} agentName={a ? `${a.emoji || "🤖"} ${a.name}` : agentSlug} agentDescription={a?.description} onConverted={() => setGen((g) => g + 1)} />;
  }
  return <ChatThread key={`${chatId}:${gen}`} id={chatId} agentName={title} agentDescription={goal} onConverted={() => setGen((g) => g + 1)} />;
}

/* ---------- project page ---------- */


type LinkKind = "knowledge" | "vibeables" | "repos" | "workflows" | "agents" | "contacts" | "places" | "events";
const LINKS: Array<{ kind: LinkKind; label: string; icon: string; href?: (slug: string) => string }> = [
  { kind: "knowledge", label: "knowledge", icon: "menu_book", href: (s) => `/knowledge/${encodeURIComponent(s)}` },
  { kind: "vibeables", label: "apps", icon: "web", href: (s) => `/vibeables/${encodeURIComponent(s)}` },
  { kind: "repos", label: "repositories", icon: "source" },
  { kind: "workflows", label: "workflows", icon: "account_tree", href: (s) => `/workflows/${encodeURIComponent(s)}` },
  { kind: "agents", label: "agents", icon: "groups", href: (s) => `/agents/${encodeURIComponent(s)}` },
  { kind: "contacts", label: "contacts", icon: "person", href: (s) => `/contacts/${encodeURIComponent(s)}` },
  { kind: "places", label: "places", icon: "location_on", href: (s) => `/places/${encodeURIComponent(s)}` },
  { kind: "events", label: "events", icon: "event", href: (s) => `/events/${encodeURIComponent(s)}` },
];

/** What the workspace offers for each link kind: slug + hint, for the add picker. */
type Option = { slug: string; hint?: string };

/** The project page's text fields: typed in place, saved when the field is left (brief and state also after a pause). */
type TextKey = "title" | "goal" | "model" | "brief" | "state";
const TEXT_KEYS: TextKey[] = ["title", "goal", "model", "brief", "state"];
/** Whether what is typed is something else than what the project has; an emptied title is not (a project keeps its title). */
const differs = (key: TextKey, text: string, p: ProjectDetail): boolean => {
  if (key === "brief" || key === "state") return text !== p[key];
  if (key === "title") return !!text.trim() && text.trim() !== p.title;
  return text.trim() !== (p[key] ?? "");
};

export function ProjectPage({ slug, onChanged }: { slug: string; onChanged: () => Promise<void> }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Typed in place; a field without a draft shows the server's value. Selects, lists and records save on each change.
  const [drafts, setDrafts] = useState<Partial<Record<TextKey, string>>>({});
  const [logEntry, setLogEntry] = useState("");
  // Links to contacts, places and events show only while those features are on.
  const features = useFeatures();
  // The project and the drafts as they stand now, for the saves that run later (after a pause, on leaving the page).
  const projectRef = useRef<ProjectDetail | null>(null);
  const draftsRef = useRef<Partial<Record<TextKey, string>>>({});
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removedRef = useRef(false);

  const show = (p: ProjectDetail) => {
    projectRef.current = p;
    setProject(p);
  };
  const draft = (next: Partial<Record<TextKey, string>>) => {
    draftsRef.current = next;
    setDrafts(next);
  };

  useEffect(() => {
    let alive = true;
    api
      .call("projects.get", { slug })
      .then((p) => alive && show(p))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  /** Saves go one after the other; a patch given as a function is worked out when its turn comes. */
  const save = (patch: Record<string, unknown> | (() => Record<string, unknown> | null), keepalive = false): Promise<void> => {
    pendingRef.current++;
    setSaving(true);
    const run = queueRef.current.then(async () => {
      const body = typeof patch === "function" ? patch() : patch;
      if (body && !removedRef.current) {
        setError("");
        try {
          show(await putProject(slug, body, keepalive));
          await onChanged();
        } catch (err) {
          setError((err as Error).message);
          // Not saved: a select goes back to what the server has (what was typed stays in its field).
          const stored = await api.call("projects.get", { slug }).catch(() => null);
          if (stored) show(stored);
        }
      }
      pendingRef.current--;
      if (pendingRef.current === 0) setSaving(false);
    });
    queueRef.current = run;
    return run;
  };
  /** A select of the side column: shown at once, saved right away. */
  const set = (patch: Partial<Pick<ProjectDetail, "status" | "harness" | "effort">>) => {
    if (projectRef.current) show({ ...projectRef.current, ...patch });
    void save(patch);
  };

  /** What is typed and not saved yet, as one patch. */
  const unsaved = (): Record<string, string> | null => {
    const p = projectRef.current;
    if (!p) return null;
    const patch: Record<string, string> = {};
    for (const key of TEXT_KEYS) {
      const text = draftsRef.current[key];
      if (text !== undefined && differs(key, text, p)) patch[key] = text;
    }
    return Object.keys(patch).length ? patch : null;
  };
  const flush = (keepalive = false): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    return unsaved() ? save(unsaved, keepalive) : Promise.resolve();
  };
  /** Typing: brief and state save ~1 s after the last change (boards.tsx does the same for a task's description). */
  const type = (key: TextKey, text: string) => {
    draft({ ...draftsRef.current, [key]: text });
    if (key !== "brief" && key !== "state") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 1000);
  };
  /** Leaving a field saves it; once saved the field shows the server's value again. */
  const leave = async (key: TextKey) => {
    const text = draftsRef.current[key];
    if (text === undefined) return;
    await flush();
    const p = projectRef.current;
    if (draftsRef.current[key] !== text || !p || differs(key, text, p)) return;
    const { [key]: _saved, ...rest } = draftsRef.current;
    draft(rest);
  };
  // Leaving the page (escape in the modal, a reload) with something typed saves it too.
  useEffect(() => {
    const onUnload = () => void flush(true);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      void flush(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async () => {
    setSaving(true);
    try {
      const r = await api.request("projects.delete", { slug });
      if (!r.ok) throw new Error(r.error || "failed");
      // Gone: nothing typed is saved into it any more.
      removedRef.current = true;
      await onChanged();
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const addLog = async () => {
    const entry = logEntry.trim();
    if (!entry) return;
    setSaving(true);
    setError("");
    try {
      const r = await api.request("projects.log", { slug, body: { entry } });
      if (!r.ok) throw new Error(r.error || "failed");
      const d = r.data;
      setLogEntry("");
      if (projectRef.current) show({ ...projectRef.current, log: d.log ?? projectRef.current.log });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (pendingRef.current === 0) setSaving(false);
    }
  };

  if (gone) return <EmptyState icon="folder_off">project not found</EmptyState>;
  if (!project) return <EmptyState>loading…</EmptyState>;

  const text = (key: TextKey): string => drafts[key] ?? project[key] ?? "";
  const dirty = TEXT_KEYS.some((key) => drafts[key] !== undefined && differs(key, drafts[key]!, project));
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };
  // A field of the side column: quiet until hovered, so the column reads as facts, not as a form.
  const QUIET = "h-8 border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-surface-2 focus:bg-surface";

  return (
    // @container: the page folds to one column by its own width — it is also shown in the edit modal.
    <div className="chat-main project-page @container flex flex-col">
      <div className="mx-auto flex w-full max-w-[1120px] flex-none flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          {/* In the modal the close button sits in this line's corner. */}
          <div className="flex min-h-7 items-center gap-2 text-sm text-fg-2 [.edit-modal_&]:pr-9">
            <span aria-hidden>📁</span>
            <span className="min-w-0 truncate font-mono text-xs" title={project.path}>
              {project.path}
            </span>
            {(saving || dirty) && <span className="flex-none text-xs">{saving ? "saving…" : "unsaved"}</span>}
            <span className="flex-1" />
            {confirmRemove ? (
              <>
                <Button size="sm" variant="danger" icon="delete" disabled={saving} onClick={() => void remove()} title="Move the project, its files and log to the trash; #/trash puts it back">
                  confirm delete
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>
                  cancel
                </Button>
              </>
            ) : (
              <IconButton icon="delete" label="delete project" size="sm" disabled={saving} onClick={() => setConfirmRemove(true)} />
            )}
          </div>
          {/* The page's heading for a screen reader; the title to look at is the field under it. */}
          <h1 className="sr-only">{project.title}</h1>
          {/* A textarea, so a long title wraps instead of running out of the column. */}
          <textarea
            rows={1}
            value={text("title")}
            aria-label="title"
            className="block w-full resize-none border-0 bg-transparent p-0 font-[inherit] text-2xl leading-tight font-semibold text-fg shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:outline-none [field-sizing:content]"
            onChange={(e) => type("title", e.target.value.replace(/\n/g, " "))}
            onBlur={() => void leave("title")}
            onKeyDown={blurOnEnter}
          />
          {/* -mx-2: the quiet field's text starts where the title does. */}
          <div className="-mx-2">
            <TextField
              value={text("goal")}
              aria-label="goal"
              placeholder="what the project is for"
              className="h-8 border-transparent bg-transparent px-2 text-base text-fg-2 shadow-none hover:bg-surface-2 focus:bg-surface focus:text-fg"
              onChange={(e) => type("goal", e.target.value)}
              onBlur={() => void leave("goal")}
              onKeyDown={blurOnEnter}
            />
          </div>
        </header>
        {project.configError && <Notice tone="bad">project.yml: {project.configError}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}

        <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 @[880px]:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="m-0 text-sm font-semibold text-fg">Brief</h3>
                <span className="text-xs text-fg-2">brief.md — what done looks like, constraints, stakeholders</span>
              </div>
              <TextArea rows={10} className="resize-y font-mono text-sm" value={text("brief")} aria-label="brief" onChange={(e) => type("brief", e.target.value)} onBlur={() => void leave("brief")} />
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="m-0 text-sm font-semibold text-fg">State</h3>
                <span className="text-xs text-fg-2">state.md — current state, rewritten at the end of a session</span>
              </div>
              <TextArea rows={6} className="resize-y font-mono text-sm" value={text("state")} aria-label="state" onChange={(e) => type("state", e.target.value)} onBlur={() => void leave("state")} />
            </section>

            <RecordsPanel records={project.records} saving={saving} onSave={(records) => save({ records })} />

            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="m-0 text-sm font-semibold text-fg">Links</h3>
                <span className="text-xs text-fg-2">by name; a target that is missing in this workspace is marked</span>
              </div>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                <PanelRows>
                  {LINKS.filter((l) => !(l.kind === "contacts" || l.kind === "places" || l.kind === "events") || features[l.kind]).map((l) => (
                    <LinkRow
                      key={l.kind}
                      kind={l.kind}
                      label={l.label}
                      icon={l.icon}
                      href={l.href}
                      links={project.links[l.kind]}
                      saving={saving}
                      onChange={(target, remove) => void linkChange(slug, l.kind, target, remove, (p) => { show(p); void onChanged(); }, setError)}
                    />
                  ))}
                </PanelRows>
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold text-fg">Log</h3>
              <div className="flex items-center gap-2">
                <TextField
                  value={logEntry}
                  aria-label="log entry"
                  placeholder="Add an entry — a decision, a milestone…"
                  onChange={(e) => setLogEntry(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addLog();
                    }
                  }}
                />
                <Button icon="add" disabled={saving || !logEntry.trim()} onClick={() => void addLog()}>
                  log
                </Button>
              </div>
              <div
                className="md-body h-auto overflow-visible pt-1 text-sm [&_h1]:hidden [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-xs [&_ul]:m-0 [&_ul]:pl-[18px]"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(project.log || "_no entries yet_", { async: false }) as string) }}
              />
            </section>
          </div>

          {/* The facts: beside the project on a wide page, right under the goal on a narrow one. */}
          <aside className="order-first flex min-w-0 flex-col gap-2 @[880px]:order-none" aria-label="details">
            <dl className="m-0 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm @min-[520px]:@max-[879px]:grid-cols-[76px_minmax(0,1fr)_76px_minmax(0,1fr)]">
              <dt className="text-fg-2">Status</dt>
              <dd className="m-0">
                <Select value={project.status} aria-label="status" className={QUIET} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </dd>
              <dt className="text-fg-2">Harness</dt>
              <dd className="m-0">
                <Select value={project.harness} aria-label="harness" className={QUIET} onChange={(e) => set({ harness: e.target.value as ChatAgentId })}>
                  {HARNESSES.map((h) => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                  ))}
                </Select>
              </dd>
              <dt className="text-fg-2">Model</dt>
              <dd className="m-0">
                <TextField
                  value={text("model")}
                  aria-label="model"
                  placeholder="harness default"
                  title="e.g. sonnet, gpt-5.6-sol — empty for the harness default"
                  className={QUIET}
                  onChange={(e) => type("model", e.target.value)}
                  onBlur={() => void leave("model")}
                  onKeyDown={blurOnEnter}
                />
              </dd>
              <dt className="text-fg-2">Effort</dt>
              <dd className="m-0">
                <Select value={project.effort ?? ""} aria-label="effort" className={QUIET} onChange={(e) => set({ effort: e.target.value })}>
                  {EFFORTS.map((ef) => (
                    <option key={ef} value={ef}>{ef || "default"}</option>
                  ))}
                </Select>
              </dd>
            </dl>
            <span className="px-2 text-xs text-fg-2">harness, model and effort: what every chat in this project runs on</span>
          </aside>
        </div>
      </div>
    </div>
  );
}

async function linkChange(
  slug: string,
  kind: LinkKind,
  target: string,
  remove: boolean,
  onOk: (p: ProjectDetail) => void,
  onError: (msg: string) => void
): Promise<void> {
  try {
    const r = await api.request("projects.link", { slug, body: { kind, target, remove } });
    if (!r.ok) throw new Error(failure(r));
    onOk(r.data);
  } catch (err) {
    onError((err as Error).message);
  }
}

/** Fetch the workspace's candidates for one link kind, lazily when the picker opens. */
async function loadOptions(kind: LinkKind): Promise<Option[]> {
  switch (kind) {
    case "knowledge": {
      const d = await api.call("knowledge.list");
      return d.bundles.map((b) => ({ slug: b.name, hint: `${b.concepts} concepts` }));
    }
    case "vibeables": {
      const d = await api.call("vibeables.list");
      return d.vibeables.map((v) => ({ slug: v.slug, hint: v.dev ? "dev" : "static" }));
    }
    case "repos": {
      const d = await api.call("repos.list");
      return d.repos.map((r) => ({ slug: r.slug, hint: r.branch }));
    }
    case "workflows": {
      const d = await api.call("workflows.list");
      return d.workflows.map((w) => ({ slug: w.slug, hint: w.description ?? w.name }));
    }
    case "agents": {
      const d = await api.call("agents.list");
      return d.agents.filter((a) => !a.archived).map((a) => ({ slug: a.slug, hint: `${a.emoji} ${a.name}` }));
    }
    case "contacts": {
      const d = await api.call("contacts.list");
      return d.items.map((c) => ({ slug: c.slug, hint: [c.role, c.org].filter(Boolean).join(", ") || undefined }));
    }
    case "places": {
      const d = await api.call("places.list");
      return d.items.map((p) => ({ slug: p.slug, hint: p.address }));
    }
    case "events": {
      const d = await api.call("events.list");
      return d.items.map((e) => ({ slug: e.slug, hint: e.start }));
    }
  }
}

function LinkRow({
  kind,
  label,
  icon,
  href,
  links,
  saving,
  onChange,
}: {
  kind: LinkKind;
  label: string;
  icon: string;
  href?: (slug: string) => string;
  links: LinkState[];
  saving: boolean;
  onChange: (target: string, remove: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (!adding || options) return;
    let alive = true;
    loadOptions(kind)
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [adding, options, kind]);

  const linked = new Set(links.map((l) => l.slug));
  const free = (options ?? []).filter((o) => !linked.has(o.slug));

  return (
    <PanelRow
      icon={icon}
      title={label}
      data-link-kind={kind}
      action={
        !adding && (
          <Button size="sm" icon="add" onClick={() => setAdding(true)}>
            link
          </Button>
        )
      }
    >
        {links.length === 0 && !adding && <span className="text-xs text-fg-2">none linked</span>}
        {links.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <Tag key={l.slug} tone={l.found ? "neutral" : "bad"} title={l.found ? l.label : "configured but not found in this workspace"}>
                {href && l.found ? (
                  <Link href={href(l.slug)} className="text-inherit no-underline hover:underline">
                    {l.slug}
                  </Link>
                ) : (
                  l.slug
                )}
                {!l.found && " · not found"}
                <button
                  type="button"
                  className="-mr-1 ml-1 inline-grid size-4 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit opacity-70 hover:bg-surface hover:opacity-100 disabled:cursor-default [&_.ms]:text-[13px]"
                  aria-label={`unlink ${l.slug}`}
                  disabled={saving}
                  onClick={() => onChange(l.slug, true)}
                >
                  <Icon name="close" />
                </button>
              </Tag>
            ))}
          </span>
        )}
        {adding && (
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            {options === null ? (
              <span className="text-xs text-fg-2">loading…</span>
            ) : (
              <>
                <Select className="w-auto max-w-full min-w-48 flex-1" aria-label={`link ${label}`} value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{free.length ? `pick ${label}…` : `nothing to link`}</option>
                  {free.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.slug}{o.hint ? ` — ${o.hint}` : ""}
                    </option>
                  ))}
                </Select>
                <Button
                  disabled={saving || !pick}
                  onClick={() => {
                    onChange(pick, false);
                    setPick("");
                    setAdding(false);
                  }}
                >
                  link
                </Button>
                <Button variant="quiet" onClick={() => setAdding(false)}>
                  cancel
                </Button>
              </>
            )}
          </span>
        )}
    </PanelRow>
  );
}

/* ---------- systems of record ---------- */

const EMPTY_RECORD: SystemOfRecord = { kind: "url" };

export function RecordsPanel({ records, saving, onSave }: { records: SystemOfRecord[]; saving: boolean; onSave: (records: SystemOfRecord[]) => Promise<void> }) {
  const [draft, setDraft] = useState<SystemOfRecord | null>(null);
  const [customKind, setCustomKind] = useState(false);

  const set = (patch: Partial<SystemOfRecord>) => setDraft((d) => ({ ...(d ?? EMPTY_RECORD), ...patch }));
  const clean = (r: SystemOfRecord): SystemOfRecord => {
    const out: SystemOfRecord = { kind: r.kind.trim().toLowerCase() || "url" };
    for (const k of ["title", "url", "workspace", "note"] as const) {
      const v = (r[k] ?? "").trim();
      if (v) out[k] = v;
    }
    return out;
  };

  return (
    <Panel
      title="systems of record"
      className="flex-none"
      actions={
        <>
          <span className="text-xs text-fg-2">where the truth is managed outside kraftwerk — context for the agent, not a credential</span>
          {!draft && (
            <Button size="sm" icon="add" onClick={() => setDraft({ ...EMPTY_RECORD })}>
              add
            </Button>
          )}
        </>
      }
    >
      <PanelRows>
        {records.map((r, i) => (
          <PanelRow
            key={i}
            data-record-kind={r.kind}
            icon="database"
            title={
              <>
                {kindLabel(r.kind)}
                {r.title && <span className="text-xs font-normal text-fg-2">{r.title}</span>}
                {r.workspace && <Tag>workspace {r.workspace}</Tag>}
              </>
            }
            action={<IconButton icon="close" size="sm" label={`remove record ${r.title ?? r.kind}`} disabled={saving} onClick={() => void onSave(records.filter((_, j) => j !== i))} />}
          >
              {(r.url || r.note) && (
                <span className="text-xs leading-normal text-fg-2">
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>}
                  {r.url && r.note && " — "}
                  {r.note}
                </span>
              )}
          </PanelRow>
        ))}
        {records.length === 0 && !draft && <Hint className="px-[18px] py-3">none yet — e.g. a my.netnode.ch workspace, a Google Drive folder, a board</Hint>}
        {draft && (
          <FormStack className="max-w-[680px]">
            <FieldRow>
              <Field label="kind">
                {customKind ? (
                  <TextField value={draft.kind} aria-label="record kind" placeholder="e.g. jira" onChange={(e) => set({ kind: e.target.value })} />
                ) : (
                  <Select
                    value={draft.kind}
                    aria-label="record kind"
                    onChange={(e) => {
                      if (e.target.value === "__other") {
                        setCustomKind(true);
                        set({ kind: "" });
                      } else set({ kind: e.target.value });
                    }}
                  >
                    {Object.entries(RECORD_KINDS).map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                    <option value="__other">other…</option>
                  </Select>
                )}
              </Field>
              <Field label="title" className="flex-1">
                <TextField value={draft.title ?? ""} aria-label="record title" placeholder="e.g. Contracts folder" onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="workspace / id">
                <TextField value={draft.workspace ?? ""} aria-label="record workspace" placeholder="e.g. 22" onChange={(e) => set({ workspace: e.target.value })} />
              </Field>
            </FieldRow>
            <Field label="url">
              <TextField value={draft.url ?? ""} aria-label="record url" placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
            </Field>
            <FieldRow>
              <Field label="note — what lives there and how it is usually reached" className="flex-1">
                <TextField value={draft.note ?? ""} aria-label="record note" placeholder="e.g. tickets and roadmap; the my CLI" onChange={(e) => set({ note: e.target.value })} />
              </Field>
              <Button
                disabled={saving || !draft.kind.trim()}
                onClick={async () => {
                  await onSave([...records, clean(draft)]);
                  setDraft(null);
                  setCustomKind(false);
                }}
              >
                add record
              </Button>
              <Button variant="quiet" onClick={() => { setDraft(null); setCustomKind(false); }}>
                cancel
              </Button>
            </FieldRow>
          </FormStack>
        )}
      </PanelRows>
    </Panel>
  );
}

