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
import { Icon, Link, navigate, usePoll, fmtWhen, fmtAgo, useExpertMode } from "./shared";

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
const STATUS_CLS: Record<ProjectStatus, string> = { active: "running", paused: "aborted", done: "ok", archived: "aborted" };

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
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

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
      <div className="empty">
        {view.error && !/are off/.test(view.error) ? (
          <span className="settings-err">{view.error}</span>
        ) : (
          <>
            Projects are off. Turn them on in <a href="#/settings">settings</a> or add a <code>projects:</code> block to kraftwerk.yml.
          </>
        )}
      </div>
    );
  else if (!view) main = <div className="empty">loading…</div>;
  else if (mode === "new" || (mode === "home" && projects.length === 0)) main = <NewProject root={view.root} onCreated={reload} />;
  else if (mode === "home") main = <div className="empty">loading…</div>;
  else if (slug && !current) main = <div className="empty">no project named {slug}</div>;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ProjectChatMain key={chatId} chatId={chatId} title={current?.title ?? slug} goal={current?.goal} />
      </div>
    );
  else if (mode === "info" && slug) main = <ProjectPage key={slug} slug={slug} onChanged={reload} />;
  else if (slug) main = <ProjectLanding key={slug} slug={slug} title={current?.title ?? slug} />;
  else main = <div className="empty">loading…</div>;

  return (
    <div className={`runs-screen agents-screen projects-screen ${slug ? "has-sessions" : ""}`}>
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">projects</span>
          <span className="spacer" />
          {view?.enabled && <span className="microlabel num">{projects.length}</span>}
          {view?.enabled && (expert || projects.length === 0) && (
            <Link href="/projects/new" className="open-raw">
              <Icon name="add" className="ms-sm" /> new
            </Link>
          )}
        </div>
        <div className="side-list">
          {projects.map((p) => (
            <Link
              key={p.slug}
              href={`/projects/${encodeURIComponent(p.slug)}`}
              className={`side-row ${p.slug === slug ? "active" : ""}`}
              data-project={p.slug}
            >
              <span className={`lamp ${p.configError ? "failed" : STATUS_CLS[p.status]}`} title={p.status} />
              <div className="side-row-body">
                <div className="side-row-top">
                  <span className="side-wf">{p.title}</span>
                  {p.updatedAt && <span className="side-when num" title={p.updatedAt}>{fmtAgo(p.updatedAt)}</span>}
                </div>
                <div className="side-row-sub">
                  <span className="side-req">{p.configError ? p.configError : p.goal || p.status}</span>
                </div>
              </div>
            </Link>
          ))}
          {view && view.enabled && projects.length === 0 && <div className="viewer-note">no projects yet</div>}
          {loadError && <div className="viewer-note settings-err">{loadError}</div>}
        </div>
      </aside>
      {slug && current && <ProjectChatsSide slug={slug} chatId={chatId} />}
      <div className="runs-main">{main}</div>
    </div>
  );
}

/* ---------- create ---------- */

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
    <form className="new-chat" onSubmit={(e) => void create(e)}>
      <div className="page-head">
        <h1>new project</h1>
      </div>
      <section className="panel">
        <div className="agent-form">
          <label className="agent-field">
            title
            <input value={title} placeholder="e.g. Relaunch netnode.ch" aria-label="project title" autoFocus onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="agent-field">
            goal (one line)
            <input value={goal} placeholder="e.g. Ship the new site on NodeHive by November" aria-label="project goal" onChange={(e) => setGoal(e.target.value)} />
          </label>
          <div className="agent-form-row">
            <button className="run-btn" type="submit" disabled={busy || !title.trim()}>
              <Icon name={busy ? "progress_activity" : "add"} className="ms-sm" />
              {busy ? "creating…" : "create project"}
            </button>
          </div>
          {error && <div className="settings-err">{error}</div>}
          <div className="settings-note">
            One folder each under <code title={root}>{root}</code> with project.yml, brief.md, state.md and log.md; part of the workspace, commit it from
            the git screen. Chats opened in the project carry all of it as context.
          </div>
        </div>
      </section>
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
  if (!none) return <div className="empty">loading…</div>;
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
    <div className="new-chat">
      <div className="page-head">
        <h1>new chat in {title}</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">runs on</span>
        </div>
        <div className="agent-pick">
          <button
            className="agent-pick-btn active"
            disabled={creating || !project}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen(harness.id, { kind: "project", slug });
              setCreating(false);
            }}
          >
            <b>{creating ? "starting…" : "start chat"}</b>
            <span>{project ? `${runsOn(project)} — ${harness.hint}` : "…"}</span>
          </button>
        </div>
        <div className="settings-note" style={{ padding: "0 18px 14px" }}>
          The chat starts with the project's brief, state, systems of record and links as context. Harness, model and effort are set on
          the <Link href={`/projects/${encodeURIComponent(slug)}/info`}>project page</Link>, like an agent's.
        </div>
      </section>
    </div>
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
  if (gone) return <div className="empty">chat not found</div>;
  if (!scope) return <div className="empty">loading…</div>;
  if (channelSlug) {
    const channel = channels?.channels.find((c) => c.slug === channelSlug);
    if (!channels) return <div className="empty">loading…</div>;
    if (!channel) return <div className="empty">channel #{channelSlug} is gone — its definition under channels/ was removed</div>;
    return <ChatThread key={`${chatId}:channel`} id={chatId} channel={channel} agents={agents?.agents ?? []} />;
  }
  return <ChatThread key={`${chatId}:${gen}`} id={chatId} agentName={title} agentDescription={goal} onConverted={() => setGen((g) => g + 1)} />;
}

function ProjectChatsSide({ slug, chatId }: { slug: string; chatId?: string }) {
  // The selected chat is part of the URL so a freshly created one shows up
  // on arrival, not a poll interval later (usePoll refetches on a url change).
  const data = usePoll<{ chats: ProjectChat[] }>(`/api/chats?for=${encodeURIComponent(chatId ?? "")}`, false);
  const chats = chatsOf(data?.chats, slug);
  const [creating, setCreating] = useState(false);

  return (
    <aside className="runs-side">
      <div className="side-head">
        <span className="microlabel">chats</span>
        <span className="spacer" />
        <Link href={`/projects/${encodeURIComponent(slug)}/info`} className="open-raw" title="project page: brief, state, records, links">
          info
        </Link>
        <button
          className="open-raw"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "project", slug });
            setCreating(false);
          }}
        >
          {creating ? "…" : <><Icon name="add" className="ms-sm" /> new</>}
        </button>
      </div>
      <div className="side-list">
        {chats.map((c) => (
          <Link
            key={c.id}
            href={chatHref(c, slug)}
            className={`side-row ${c.id === chatId ? "active" : ""}`}
          >
            <span className={`lamp ${c.awaitingApproval ? "blocked" : c.busy ? "running" : "pending"}`} title={c.awaitingApproval ? "waiting for your approval" : undefined} />
            <div className="side-row-body">
              <div className="side-row-top">
                <span className="side-wf">
                  {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm" />}
                  {c.scope.kind === "channel" ? c.title || `#${c.scope.slug}` : c.title || "new chat"}
                </span>
              </div>
              <div className="side-row-sub">
                <span className="side-req">{c.scope.kind === "channel" ? `channel session · #${c.scope.slug}` : c.agent}</span>
                <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
              </div>
            </div>
            <button
              type="button"
              className="row-x"
              title="delete chat"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!window.confirm(`Delete chat "${c.title || c.id}"?`)) return;
                await fetch(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
                if (c.id === chatId) navigate(`/projects/${encodeURIComponent(slug)}`);
              }}
            >
              <Icon name="close" className="ms-sm" />
            </button>
          </Link>
        ))}
        {data && chats.length === 0 && <div className="viewer-note">no chats yet</div>}
      </div>
    </aside>
  );
}

/* ---------- project page ---------- */

type LinkKind = "knowledge" | "vibeables" | "repos" | "workflows" | "agents";
const LINKS: Array<{ kind: LinkKind; label: string; icon: string; href?: (slug: string) => string }> = [
  { kind: "knowledge", label: "knowledge", icon: "menu_book", href: (s) => `/knowledge/${encodeURIComponent(s)}` },
  { kind: "vibeables", label: "vibeables", icon: "web", href: (s) => `/vibeables/${encodeURIComponent(s)}` },
  { kind: "repos", label: "repositories", icon: "source" },
  { kind: "workflows", label: "workflows", icon: "account_tree", href: (s) => `/workflows/${encodeURIComponent(s)}` },
  { kind: "agents", label: "agents", icon: "groups", href: (s) => `/agents/${encodeURIComponent(s)}` },
];

/** What the workspace offers for each link kind: slug + hint, for the add picker. */
type Option = { slug: string; hint?: string };

function ProjectPage({ slug, onChanged }: { slug: string; onChanged: () => Promise<void> }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
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
      navigate("/projects", { replace: true });
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

  if (gone) return <div className="empty">project not found</div>;
  if (!project) return <div className="empty">loading…</div>;

  return (
    <div className="chat-main project-page">
      <div className="detail-head">
        <span className="agent-avatar lg">
          <span aria-hidden>📁</span>
        </span>
        <h1>{project.title}</h1>
        <span className={`chip status ${STATUS_CLS[project.status]}`}>{project.status}</span>
        <span className="chip" title="harness · model · effort every chat in this project runs on">{runsOn(project)}</span>
        {expert && <span className="rid" title={project.path}>{project.path}</span>}
        <span className="spacer" />
        <button
          className="run-btn"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "project", slug });
            setCreating(false);
          }}
        >
          {creating ? "starting…" : "new chat"}
        </button>
      </div>
      {project.configError && <div className="settings-err">project.yml: {project.configError}</div>}

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">project</span>
          <span className="spacer" />
          {saved && !dirty && <span className="settings-note">saved</span>}
          <button className="run-btn" disabled={saving || !dirty} onClick={() => void save({ title, goal, status, harness, model, effort, brief, state })}>
            {saving ? "saving…" : "save changes"}
          </button>
        </div>
        <div className="agent-form">
          <div className="agent-form-row">
            <label className="agent-field" style={{ flex: 1 }}>
              title
              <input value={title} aria-label="title" onChange={(e) => { setTitle(e.target.value); touch(); }} />
            </label>
            <label className="agent-field">
              status
              <select value={status} aria-label="status" onChange={(e) => { setStatus(e.target.value as ProjectStatus); touch(); }}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="agent-form-row">
            <label className="agent-field" style={{ width: 140 }}>
              harness
              <select value={harness} aria-label="harness" onChange={(e) => { setHarness(e.target.value as ChatAgentId); touch(); }}>
                {HARNESSES.map((h) => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </select>
            </label>
            <label className="agent-field" style={{ flex: 1 }}>
              model
              <input value={model} aria-label="model" placeholder="harness default — e.g. sonnet, gpt-5.6-sol" onChange={(e) => { setModel(e.target.value); touch(); }} />
            </label>
            <label className="agent-field" style={{ width: 140 }}>
              effort
              <select value={effort} aria-label="effort" onChange={(e) => { setEffort(e.target.value); touch(); }}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>{ef || "default"}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="agent-field">
            goal (one line)
            <input value={goal} aria-label="goal" placeholder="what the project is for" onChange={(e) => { setGoal(e.target.value); touch(); }} />
          </label>
          <label className="agent-field">
            brief.md — what done looks like, constraints, stakeholders
            <textarea rows={10} value={brief} aria-label="brief" onChange={(e) => { setBrief(e.target.value); touch(); }} />
          </label>
          <label className="agent-field">
            state.md — current state, rewritten at the end of a session
            <textarea rows={6} value={state} aria-label="state" onChange={(e) => { setState(e.target.value); touch(); }} />
          </label>
          {error && <div className="settings-err">{error}</div>}
        </div>
      </section>

      <RecordsPanel records={project.records} saving={saving} onSave={(records) => save({ records }, { keepEdits: true })} />

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">links</span>
          <span className="spacer" />
          <span className="settings-note">by name; a target that is missing in this workspace is marked</span>
        </div>
        <div className="m3-list">
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
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">log</span>
          <span className="spacer" />
        </div>
        <div className="agent-form">
          <div className="agent-form-row">
            <label className="agent-field" style={{ flex: 1 }}>
              new entry — a decision, a milestone
              <input
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
            </label>
            <button className="run-btn tonal" disabled={saving || !logEntry.trim()} onClick={() => void addLog()}>
              <Icon name="add" className="ms-sm" /> log
            </button>
          </div>
        </div>
        <div
          className="md-body project-log"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(project.log || "_no entries yet_", { async: false }) as string) }}
        />
      </section>

      {expert && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">danger zone</span>
            <span className="spacer" />
            {!confirmRemove ? (
              <button className="stop-btn" disabled={saving} onClick={() => setConfirmRemove(true)} title="Delete the folder; its history stays in the workspace git">
                <Icon name="delete" className="ms-sm" /> remove project
              </button>
            ) : (
              <>
                <button className="stop-btn" disabled={saving} onClick={() => void remove()}>
                  <Icon name="delete" className="ms-sm" /> confirm remove
                </button>
                <button className="open-raw" onClick={() => setConfirmRemove(false)}>cancel</button>
              </>
            )}
          </div>
        </section>
      )}
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
    <div className="m3-row" data-link-kind={kind}>
      <span className="m3-ico"><Icon name={icon} /></span>
      <span className="m3-body">
        <span className="m3-head">{label}</span>
        {links.length === 0 && !adding && <span className="m3-sub">none linked</span>}
        {links.length > 0 && (
          <span className="m3-chips">
            {links.map((l) => (
              <span key={l.slug} className={`chip ${l.found ? "" : "attention"}`} title={l.found ? l.label : "configured but not found in this workspace"}>
                {href && l.found ? <Link href={href(l.slug)}>{l.slug}</Link> : l.slug}
                {!l.found && " · not found"}
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`unlink ${l.slug}`}
                  disabled={saving}
                  onClick={() => onChange(l.slug, true)}
                >
                  <Icon name="close" className="ms-sm" />
                </button>
              </span>
            ))}
          </span>
        )}
        {adding && (
          <span className="agent-form-row" style={{ marginTop: 6 }}>
            {options === null ? (
              <span className="m3-sub">loading…</span>
            ) : (
              <>
                <select aria-label={`link ${label}`} value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{free.length ? `pick ${label}…` : `nothing to link`}</option>
                  {free.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.slug}{o.hint ? ` — ${o.hint}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  className="run-btn tonal"
                  disabled={saving || !pick}
                  onClick={() => {
                    onChange(pick, false);
                    setPick("");
                    setAdding(false);
                  }}
                >
                  link
                </button>
                <button className="open-raw" onClick={() => setAdding(false)}>cancel</button>
              </>
            )}
          </span>
        )}
      </span>
      {!adding && (
        <button className="open-raw" onClick={() => setAdding(true)}>
          <Icon name="add" className="ms-sm" /> link
        </button>
      )}
    </div>
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
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">systems of record</span>
        <span className="spacer" />
        <span className="settings-note">where the truth is managed outside kraftwerk — context for the agent, not a credential</span>
        {!draft && (
          <button className="open-raw" onClick={() => setDraft({ ...EMPTY_RECORD })}>
            <Icon name="add" className="ms-sm" /> add
          </button>
        )}
      </div>
      <div className="m3-list">
        {records.map((r, i) => (
          <div className="m3-row" key={i} data-record-kind={r.kind}>
            <span className="m3-ico"><Icon name="database" /></span>
            <span className="m3-body">
              <span className="m3-head">
                {kindLabel(r.kind)}
                {r.title && <span className="m3-sub">{r.title}</span>}
                {r.workspace && <span className="chip">workspace {r.workspace}</span>}
              </span>
              {(r.url || r.note) && (
                <span className="m3-sub">
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>}
                  {r.url && r.note && " — "}
                  {r.note}
                </span>
              )}
            </span>
            <button className="open-raw" aria-label={`remove record ${r.title ?? r.kind}`} disabled={saving} onClick={() => void onSave(records.filter((_, j) => j !== i))}>
              <Icon name="close" className="ms-sm" />
            </button>
          </div>
        ))}
        {records.length === 0 && !draft && <div className="viewer-note">none yet — e.g. a my.netnode.ch workspace, a Google Drive folder, a board</div>}
        {draft && (
          <div className="agent-form">
            <div className="agent-form-row">
              <label className="agent-field">
                kind
                {customKind ? (
                  <input value={draft.kind} aria-label="record kind" placeholder="e.g. jira" onChange={(e) => set({ kind: e.target.value })} />
                ) : (
                  <select
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
                  </select>
                )}
              </label>
              <label className="agent-field" style={{ flex: 1 }}>
                title
                <input value={draft.title ?? ""} aria-label="record title" placeholder="e.g. Contracts folder" onChange={(e) => set({ title: e.target.value })} />
              </label>
              <label className="agent-field">
                workspace / id
                <input value={draft.workspace ?? ""} aria-label="record workspace" placeholder="e.g. 22" onChange={(e) => set({ workspace: e.target.value })} />
              </label>
            </div>
            <div className="agent-form-row">
              <label className="agent-field" style={{ flex: 1 }}>
                url
                <input value={draft.url ?? ""} aria-label="record url" placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
              </label>
            </div>
            <div className="agent-form-row">
              <label className="agent-field" style={{ flex: 1 }}>
                note — what lives there and how it is usually reached
                <input value={draft.note ?? ""} aria-label="record note" placeholder="e.g. tickets and roadmap; the my CLI" onChange={(e) => set({ note: e.target.value })} />
              </label>
              <button
                className="run-btn tonal"
                disabled={saving || !draft.kind.trim()}
                onClick={async () => {
                  await onSave([...records, clean(draft)]);
                  setDraft(null);
                  setCustomKind(false);
                }}
              >
                add record
              </button>
              <button className="open-raw" onClick={() => { setDraft(null); setCustomKind(false); }}>cancel</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

