import { useCallback, useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  Agent,
  ChatAgentId,
  ChatMeta,
  ChannelView,
  KnowledgeIndex,
  LinkState,
  ProjectDetail,
  ProjectStatus,
  ProjectsView,
  ReposView,
  SystemOfRecord,
  VibeablesView,
  WorkflowSummary,
} from "./types";
import { ChatThread, createChatAndOpen } from "./chat";
import { EFFORTS, Icon, Link, navigate, usePoll, fmtAgo, useExpertMode, PROJECTS_CHANGED_EVENT } from "./shared";
import { NewTabButton, SessionsPane, useSessionsList, type Session } from "./sessions";
import { Avatar, Button, Dot, EmptyState, Field, FieldRow, FormStack, Hint, IconButton, ListRow, Notice, Page, Panel, PanelRow, PanelRows, Select, SideHead, SideList, SideNote, Tag, TextArea, TextField, Title, type DotTone } from "./ui";

/**
 * Projects: a goal with everything the agents need to reach it in one
 * folder (kraftwerk-data/projects/<slug>/): brief, systems of record,
 * links to knowledge, vibeables, repositories, workflows and agents.
 * Working in a project is chat. The screen is a double sidebar like the
 * agents screen: projects on the left, the selected project's chats next
 * to it, and the main pane shows a chat thread, the project page (/info)
 * or the new-chat pane. Routes:
 *   #/projects                       latest project (or the create form)
 *   #/projects/new                   create form
 *   #/projects/<slug>                the project's latest chat, else the new-chat pane
 *   #/projects/<slug>/chat/<chatId>  one chat thread
 *   #/projects/<slug>/info           the project page
 */

const STATUSES: ProjectStatus[] = ["active", "paused", "done", "archived"];
const STATUS_DOT: Record<ProjectStatus, DotTone> = { active: "working", paused: "idle", done: "ok", archived: "idle" };
const STATUS_TAG: Record<ProjectStatus, "accent" | "ok" | "neutral"> = { active: "accent", paused: "neutral", done: "ok", archived: "neutral" };

const RECORD_KINDS: Record<string, string> = {
  "my-netnode": "my.netnode.ch",
  "google-drive": "Google Drive",
  github: "GitHub",
  bitbucket: "Bitbucket",
  notion: "Notion",
  slack: "Slack",
  url: "Link",
};
const kindLabel = (kind: string): string => RECORD_KINDS[kind] ?? kind;

const HARNESSES: Array<{ id: ChatAgentId; label: string; hint: string }> = [
  { id: "claude", label: "claude", hint: "Claude Code via ACP" },
  { id: "codex", label: "codex", hint: "Codex (ChatGPT) via ACP" },
  { id: "pi", label: "pi", hint: "pi coding agent" },
];

/** "claude · sonnet · effort high" — what a project's chats run on. */
const runsOn = (p: { harness: ChatAgentId; model?: string; effort?: string }): string =>
  [p.harness, p.model, p.effort ? `effort ${p.effort}` : ""].filter(Boolean).join(" · ");

type ProjectChat = ChatMeta & { busy: boolean; awaitingApproval?: boolean };
/** The project's own chats, plus the channels that started as one of them (meta.project). */
const chatsOf = (chats: ProjectChat[] | undefined, slug: string): ProjectChat[] =>
  (chats ?? []).filter((c) => (c.scope.kind === "project" && c.scope.slug === slug) || c.project === slug);
/** Every chat of a project opens here — a channel session too; it just renders in channel mode. */
const chatHref = (c: ProjectChat, slug: string): string => `/projects/${encodeURIComponent(slug)}/chat/${c.id}`;

async function putProject(slug: string, patch: Record<string, unknown>): Promise<ProjectDetail> {
  const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const d = (await r.json()) as ProjectDetail & { error?: string };
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export function ProjectsScreen({ seg }: { seg: string[] }) {
  // seg (after /projects): [] | [new] | [slug] | [slug, info] | [slug, chat, chatId]
  const slug = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const mode = seg[0] === "new" ? "new" : seg[1] === "info" ? "info" : seg[1] === "chat" ? "chat" : slug ? "project" : "home";
  const chatId = mode === "chat" ? seg[2] : undefined;

  const [view, setView] = useState<ProjectsView | null>(null);
  const [loadError, setLoadError] = useState("");
  const expert = useExpertMode();
  const listOpen = useSessionsList();

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView((await r.json()) as ProjectsView);
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
  else if (mode === "chat" && slug && chatId === "new") main = <NewProjectChat key={slug} slug={slug} title={current?.title ?? slug} />;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ProjectChatMain key={chatId} chatId={chatId} title={current?.title ?? slug} goal={current?.goal} />
      </div>
    );
  else if (mode === "info" && slug) main = <ProjectPage key={slug} slug={slug} onChanged={reload} />;
  else if (slug) main = <ProjectLanding key={slug} slug={slug} title={current?.title ?? slug} />;
  else main = <EmptyState>loading…</EmptyState>;

  return (
    <div className={`runs-screen agents-screen projects-screen ${slug && current ? "has-tabs" : ""} ${slug && current && listOpen ? "has-sessions" : ""}`}>
      <aside className="runs-side">
        <SideHead
          title="projects"
          count={view?.enabled ? projects.length : undefined}
          action={
            view?.enabled &&
            (expert || projects.length === 0) && (
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
      {slug && current && <ProjectSessions slug={slug} chatId={chatId === "new" ? undefined : chatId} />}
      <div className="runs-main">{main}</div>
    </div>
  );
}

/* ---------- create ---------- */

/** The create form on its own (the modal over a conversation): reads the root it will write to. */
export function NewProjectPage() {
  const view = usePoll<ProjectsView>("/api/projects", false, 60_000);
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
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t, goal: goal.trim() }),
      });
      const d = (await r.json()) as ProjectDetail & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
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

/* ---------- landing + chats sidebar ---------- */

/**
 * A bare #/projects/<slug> jumps into the project's most recent chat; with
 * none yet it offers to start one.
 */
function ProjectLanding({ slug, title }: { slug: string; title: string }) {
  const [none, setNone] = useState(false);
  useEffect(() => {
    let alive = true;
    setNone(false);
    fetch("/api/chats")
      .then((r) => r.json())
      .then((d: { chats: ChatMeta[] }) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind === "project" && c.scope.slug === slug);
        if (latest) navigate(`/projects/${encodeURIComponent(slug)}/chat/${latest.id}`, { replace: true });
        else setNone(true);
      })
      .catch(() => alive && setNone(true));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!none) return <EmptyState>loading…</EmptyState>;
  return <NewProjectChat slug={slug} title={title} />;
}

function NewProjectChat({ slug, title }: { slug: string; title: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: ProjectDetail) => alive && setProject(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);
  const harness = HARNESSES.find((h) => h.id === project?.harness) ?? HARNESSES[0];
  return (
    <Page width="narrow">
      <Title size="lg">new chat in {title}</Title>
      <Panel title="runs on">
        <div className="p-4">
          <button
            type="button"
            className="flex w-full cursor-pointer flex-col gap-0.5 rounded-card border border-transparent bg-accent-soft px-3.5 py-3 text-left text-on-accent-soft transition-[filter] hover:enabled:brightness-[0.97] disabled:cursor-default disabled:opacity-60"
            disabled={creating || !project}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen(harness.id, { kind: "project", slug });
              setCreating(false);
            }}
          >
            <b className="text-base font-medium">{creating ? "starting…" : "start chat"}</b>
            <span className="text-xs">{project ? `${runsOn(project)} — ${harness.hint}` : "…"}</span>
          </button>
        </div>
        <Hint className="px-[18px] pb-3.5">
          The chat starts with the project's brief, state, systems of record and links as context. Harness, model and effort are set on
          the <Link href={`/projects/${encodeURIComponent(slug)}/info`}>project page</Link>, like an agent's.
        </Hint>
      </Panel>
    </Page>
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
    fetch(`/api/chats/${chatId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { meta: ChatMeta }) => alive && setScope(d.meta.scope))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [chatId, gen]);
  const channelSlug = scope?.kind === "channel" ? scope.slug : undefined;
  const channels = usePoll<{ channels: ChannelView[] }>(channelSlug ? "/api/channels" : "", false, 4000);
  const agents = usePoll<{ agents: Agent[] }>(channelSlug ? "/api/agents" : "", false, 8000);
  if (gone) return <EmptyState icon="chat_error">chat not found</EmptyState>;
  if (!scope) return <EmptyState>loading…</EmptyState>;
  if (channelSlug) {
    const channel = channels?.channels.find((c) => c.slug === channelSlug);
    if (!channels) return <EmptyState>loading…</EmptyState>;
    if (!channel) return <EmptyState icon="forum">channel #{channelSlug} is gone — its definition under channels/ was removed</EmptyState>;
    return <ChatThread key={`${chatId}:channel`} id={chatId} channel={channel} agents={agents?.agents ?? []} />;
  }
  return <ChatThread key={`${chatId}:${gen}`} id={chatId} agentName={title} agentDescription={goal} onConverted={() => setGen((g) => g + 1)} />;
}

/** The project's chats: open ones as tabs above the chat, all of them in the list on request. */
function ProjectSessions({ slug, chatId }: { slug: string; chatId?: string }) {
  const [creating, setCreating] = useState(false);
  const filter = useCallback((chats: Session[]) => chatsOf(chats, slug), [slug]);
  const hrefOf = useCallback((c: Session) => chatHref(c, slug), [slug]);
  return (
    <SessionsPane
      storeKey={`project:${slug}`}
      label="chats"
      fallbackTitle="new chat"
      chatId={chatId}
      filter={filter}
      hrefOf={hrefOf}
      closeHref={`/projects/${encodeURIComponent(slug)}/chat/new`}
      subOf={(c) => (c.scope.kind === "channel" ? `with coworkers · #${c.scope.slug}` : c.agent)}
      actions={
        <NewTabButton
          busy={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "project", slug });
            setCreating(false);
          }}
        />
      }
    />
  );
}

/* ---------- project page ---------- */


type LinkKind = "knowledge" | "vibeables" | "repos" | "workflows" | "agents";
const LINKS: Array<{ kind: LinkKind; label: string; icon: string; href?: (slug: string) => string }> = [
  { kind: "knowledge", label: "knowledge", icon: "menu_book", href: (s) => `/knowledge/${encodeURIComponent(s)}` },
  { kind: "vibeables", label: "apps", icon: "web", href: (s) => `/vibeables/${encodeURIComponent(s)}` },
  { kind: "repos", label: "repositories", icon: "source" },
  { kind: "workflows", label: "workflows", icon: "account_tree", href: (s) => `/workflows/${encodeURIComponent(s)}` },
  { kind: "agents", label: "agents", icon: "groups", href: (s) => `/agents/${encodeURIComponent(s)}` },
];

/** What the workspace offers for each link kind: slug + hint, for the add picker. */
type Option = { slug: string; hint?: string };

export function ProjectPage({ slug, onChanged }: { slug: string; onChanged: () => Promise<void> }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Head fields and the two documents are edited in place; lists and records save on each change.
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [harness, setHarness] = useState<ChatAgentId>("claude");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [brief, setBrief] = useState("");
  const [state, setState] = useState("");
  const [dirty, setDirty] = useState(false);
  const [logEntry, setLogEntry] = useState("");
  const expert = useExpertMode();

  const apply = (p: ProjectDetail) => {
    setProject(p);
    setTitle(p.title);
    setGoal(p.goal);
    setStatus(p.status);
    setHarness(p.harness);
    setModel(p.model ?? "");
    setEffort(p.effort ?? "");
    setBrief(p.brief);
    setState(p.state);
    setDirty(false);
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: ProjectDetail) => alive && apply(p))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setError("");
  };

  const save = async (patch: Record<string, unknown>, opts: { keepEdits?: boolean } = {}) => {
    setSaving(true);
    setError("");
    try {
      const p = await putProject(slug, patch);
      if (opts.keepEdits) setProject(p);
      else apply(p);
      setSaved(!opts.keepEdits);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      await onChanged();
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
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
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/log`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry }),
      });
      const d = (await r.json()) as { ok?: boolean; log?: string; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      setLogEntry("");
      setProject((p) => (p ? { ...p, log: d.log ?? p.log } : p));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (gone) return <EmptyState icon="folder_off">project not found</EmptyState>;
  if (!project) return <EmptyState>loading…</EmptyState>;

  return (
    <div className="chat-main project-page flex flex-col gap-3">
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2">
        <Avatar>
          <span aria-hidden>📁</span>
        </Avatar>
        <Title size="lg">{project.title}</Title>
        <Tag tone={STATUS_TAG[project.status]}>{project.status}</Tag>
        <Tag title="harness · model · effort every chat in this project runs on">{runsOn(project)}</Tag>
        {expert && (
          <span className="min-w-0 truncate font-mono text-xs text-fg-2" title={project.path}>
            {project.path}
          </span>
        )}
      </div>
      {project.configError && <Notice tone="bad">project.yml: {project.configError}</Notice>}

      <Panel
        title="project"
        className="flex-none"
        actions={
          <>
            {saved && !dirty && <span className="text-xs text-fg-2">saved</span>}
            <Button variant="primary" size="sm" busy={saving} disabled={!dirty} onClick={() => void save({ title, goal, status, harness, model, effort, brief, state })}>
              {saving ? "saving…" : "save changes"}
            </Button>
          </>
        }
      >
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="title" className="flex-1">
              <TextField value={title} aria-label="title" onChange={(e) => { setTitle(e.target.value); touch(); }} />
            </Field>
            <Field label="status">
              <Select value={status} aria-label="status" onChange={(e) => { setStatus(e.target.value as ProjectStatus); touch(); }}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="harness" className="w-[140px] max-[940px]:w-auto">
              <Select value={harness} aria-label="harness" onChange={(e) => { setHarness(e.target.value as ChatAgentId); touch(); }}>
                {HARNESSES.map((h) => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="model" className="flex-1">
              <TextField value={model} aria-label="model" placeholder="harness default — e.g. sonnet, gpt-5.6-sol" onChange={(e) => { setModel(e.target.value); touch(); }} />
            </Field>
            <Field label="effort" className="w-[140px] max-[940px]:w-auto">
              <Select value={effort} aria-label="effort" onChange={(e) => { setEffort(e.target.value); touch(); }}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>{ef || "default"}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="goal (one line)">
            <TextField value={goal} aria-label="goal" placeholder="what the project is for" onChange={(e) => { setGoal(e.target.value); touch(); }} />
          </Field>
          <Field label="brief.md — what done looks like, constraints, stakeholders">
            <TextArea rows={10} className="resize-y font-mono text-sm" value={brief} aria-label="brief" onChange={(e) => { setBrief(e.target.value); touch(); }} />
          </Field>
          <Field label="state.md — current state, rewritten at the end of a session">
            <TextArea rows={6} className="resize-y font-mono text-sm" value={state} aria-label="state" onChange={(e) => { setState(e.target.value); touch(); }} />
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
        </FormStack>
      </Panel>

      <RecordsPanel records={project.records} saving={saving} onSave={(records) => save({ records }, { keepEdits: true })} />

      <Panel title="links" className="flex-none" actions={<span className="text-xs text-fg-2">by name; a target that is missing in this workspace is marked</span>}>
        <PanelRows>
          {LINKS.map((l) => (
            <LinkRow
              key={l.kind}
              kind={l.kind}
              label={l.label}
              icon={l.icon}
              href={l.href}
              links={project.links[l.kind]}
              saving={saving}
              onChange={(target, remove) => void linkChange(slug, l.kind, target, remove, (p) => { setProject(p); void onChanged(); }, setError)}
            />
          ))}
        </PanelRows>
      </Panel>

      <Panel title="log" className="flex-none">
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="new entry — a decision, a milestone" className="flex-1">
              <TextField
                value={logEntry}
                aria-label="log entry"
                placeholder="e.g. Decided on NodeHive as the CMS"
                onChange={(e) => setLogEntry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addLog();
                  }
                }}
              />
            </Field>
            <Button icon="add" disabled={saving || !logEntry.trim()} onClick={() => void addLog()}>
              log
            </Button>
          </FieldRow>
        </FormStack>
        <div
          className="md-body h-auto overflow-visible px-[18px] pt-1 pb-4 text-sm [&_h1]:hidden [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-xs [&_ul]:m-0 [&_ul]:pl-[18px]"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(project.log || "_no entries yet_", { async: false }) as string) }}
        />
      </Panel>

      <Panel
        title="danger zone"
        className="flex-none [&>div]:border-b-0"
        actions={
          !confirmRemove ? (
            <Button size="sm" variant="danger" icon="delete" disabled={saving} onClick={() => setConfirmRemove(true)} title="Move the project, its files and log to the trash; #/trash puts it back">
              delete project
            </Button>
          ) : (
            <>
              <Button size="sm" variant="danger" icon="delete" disabled={saving} onClick={() => void remove()}>
                confirm delete
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>
                cancel
              </Button>
            </>
          )
        }
      >
        {null}
      </Panel>
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
    const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, target, remove }),
    });
    const d = (await r.json()) as ProjectDetail & { error?: string };
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    onOk(d);
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  } catch (err) {
    onError((err as Error).message);
  }
}

/** Fetch the workspace's candidates for one link kind, lazily when the picker opens. */
async function loadOptions(kind: LinkKind): Promise<Option[]> {
  switch (kind) {
    case "knowledge": {
      const d = (await (await fetch("/api/knowledge")).json()) as KnowledgeIndex;
      return d.bundles.map((b) => ({ slug: b.name, hint: `${b.concepts} concepts` }));
    }
    case "vibeables": {
      const d = (await (await fetch("/api/vibeables")).json()) as VibeablesView;
      return d.vibeables.map((v) => ({ slug: v.slug, hint: v.dev ? "dev" : "static" }));
    }
    case "repos": {
      const d = (await (await fetch("/api/repos")).json()) as ReposView;
      return d.repos.map((r) => ({ slug: r.slug, hint: r.branch }));
    }
    case "workflows": {
      const d = (await (await fetch("/api/workflows")).json()) as { workflows: WorkflowSummary[] };
      return d.workflows.map((w) => ({ slug: w.slug, hint: w.description ?? w.name }));
    }
    case "agents": {
      const d = (await (await fetch("/api/agents")).json()) as { agents: Agent[] };
      return d.agents.filter((a) => !a.archived).map((a) => ({ slug: a.slug, hint: `${a.emoji} ${a.name}` }));
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

function RecordsPanel({ records, saving, onSave }: { records: SystemOfRecord[]; saving: boolean; onSave: (records: SystemOfRecord[]) => Promise<void> }) {
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

