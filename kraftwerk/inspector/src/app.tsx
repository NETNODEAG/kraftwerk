import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { AttentionItem, Notification, NotificationKind, NotificationsView, RunListItem } from "./types";
import { NextButton, openAttention, ownerText, useAttention, useFocusRequest } from "./attention";
import { Button, cn, Dot, EmptyState, Eyebrow, IconButton, ListRow, Section } from "./ui";
import { EditModal, editScreenOf } from "./edit-modal";
import { COLUMN_PATH_EVENT, CHAT_ROUTES, columnOf, Icon, fmtAgo, navigate, setAttentionCount, setBaseTitle, setExpertMode, startWorkspace, useExpertMode, useHashPath, usePoll, workspaceColor, wsPalette, WorkspaceTile, setFeatures } from "./shared";
import { RunsScreen } from "./runs";
import { WorkflowsScreen } from "./workflows";
import { DashboardScreen } from "./dashboard";
import { KnowledgeScreen } from "./knowledge";
import { SkillsScreen } from "./skills";
import { AgentsScreen } from "./agents";
import { ChannelsScreen } from "./channels";
import { SettingsScreen } from "./settings";
import { TrashScreen } from "./trash";
import { FilesScreen } from "./files";
import { UiGallery } from "./ui-gallery";
import { WorkspacesScreen } from "./workspaces";
import { GitScreen } from "./git";
import { ReposScreen } from "./repos";
import { VibeablesScreen } from "./vibeables";
import { ProjectsScreen } from "./projects";
import { SearchPalette } from "./search";
import { ConversationsRail } from "./rail";
import { GlobalNav } from "./workspace-tabs";
import { ContextPanel } from "./context-panel";

const CHAT_PATH_KEY = "kw-chat-path";
/** Width of the context column in px, set by dragging the divider; absent = half. */
const CTX_W_KEY = "kw-ctx-w";
const readCtxW = (): number | null => {
  try {
    const n = Number(localStorage.getItem(CTX_W_KEY));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
};

/**
 * The divider between the conversation and its context: drag to resize,
 * double-click to go back to half. The width is remembered per browser.
 */
function SplitHandle({ onResize }: { onResize: (px: number | null) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`split-handle${drag ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="resize chat and context"
      title="drag to resize · double-click for half and half"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const shell = e.currentTarget.closest(".shell") as HTMLElement | null;
        if (!shell) return;
        e.preventDefault();
        // The context column ends at the shell's content edge; its width is the distance from the pointer.
        const right = shell.getBoundingClientRect().right - parseFloat(getComputedStyle(shell).paddingRight);
        const move = (ev: PointerEvent) => onResize(Math.round(right - ev.clientX));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          document.body.classList.remove("kw-resizing");
          setDrag(false);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        document.body.classList.add("kw-resizing");
        setDrag(true);
      }}
      onDoubleClick={() => onResize(null)}
    />
  );
}

const remembered = (key: string, fallback: string): string => {
  try {
    return sessionStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* the column simply starts over next time */
  }
};

/**
 * Shell + hash router. Routes: #/ (dashboard), #/runs (redirect to latest
 * run), #/runs/<id>, #/workflows, #/workflows/<slug>[/details | /runs],
 * #/knowledge[/<bundle>[/<concept-path>]], #/skills[/<name>],
 * #/agents[/new | /chats[/new | /<chatId>] | /<slug>[/info | /edit | /chat/<chatId>]],
 * #/repos, #/git, #/settings, #/workspaces.
 * A bare #/agents/<slug> opens the agent's most recent session; the profile
 * lives at /info. Legacy #/team/* and #/chats[/<id>] links still land here.
 * ⌘K opens the agent palette (search.tsx) from anywhere.
 */
export function App() {
  const hash = useHashPath();
  useFocusRequest();
  // "#/runs/<id>?workflow=x": the query rides along the hash path.
  const [path] = hash.split("?");
  const seg = path.split("/").filter(Boolean);
  const [projectName, setProjectName] = useState("");
  const [projectIcon, setProjectIcon] = useState("");
  const [projectColor, setProjectColor] = useState("");
  const [projectNamed, setProjectNamed] = useState(true);
  const [projectRoot, setProjectRoot] = useState("");
  const [projectRootAbs, setProjectRootAbs] = useState("");
  const [switcher, setSwitcher] = useState<SwitcherEntry[]>([]);
  // A conversation route shows the columns: the rail, the conversation, and
  // its context. Every other route is a page of the workspace (the overview,
  // workflows, knowledge, …) under the top bar; the conversation keeps its
  // last path meanwhile and comes back with the next conversation link.
  const isChatRoute = CHAT_ROUTES.has(seg[0] ?? "");
  // Home (#/) is today's dashboard, in the middle column with the rail beside it.
  const isHome = seg.length === 0;
  const [chatPath, setChatPath] = useState(() => remembered(CHAT_PATH_KEY, "/agents/chats"));
  // Editing the thing you talk to (its /info or /edit route) is a modal over the conversation.
  const editScreen = isChatRoute ? editScreenOf(path) : null;
  const effChat = isChatRoute && !editScreen ? path : chatPath;
  // Phones show one column at a time.
  const [focus, setFocus] = useState<"chat" | "context">("chat");
  const [ctxW, setCtxW] = useState<number | null>(readCtxW);
  const resizeCtx = (px: number | null) => {
    setCtxW(px);
    try {
      if (px === null) localStorage.removeItem(CTX_W_KEY);
      else localStorage.setItem(CTX_W_KEY, String(px));
    } catch {}
  };
  useEffect(() => {
    if (isChatRoute && !editScreenOf(path)) {
      setChatPath(path);
      remember(CHAT_PATH_KEY, path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  // A redirect of the column the hash is not about (see navigate in shared.tsx).
  useEffect(() => {
    const onPath = (e: Event) => {
      const to = (e as CustomEvent<string>).detail;
      if (columnOf(to) === "chat") {
        setChatPath(to);
        remember(CHAT_PATH_KEY, to);
      } else window.location.replace(`#${to}`);
    };
    window.addEventListener(COLUMN_PATH_EVENT, onPath);
    return () => window.removeEventListener(COLUMN_PATH_EVENT, onPath);
  }, []);
  // Polled (not fetched once): the switcher auto-discovers other running
  // instances via ~/.kraftwerk/instances, so entries come and go.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = (await fetch("/api/meta", { cache: "no-store" }).then((r) => r.json())) as {
          projectName?: string;
          projectIcon?: string;
          projectColor?: string;
          projectNamed?: boolean;
          projectRoot?: string;
          projectRootLabel?: string;
          git?: boolean;
          repos?: boolean;
          vibeables?: boolean;
          projects?: boolean;
          switcher?: SwitcherEntry[];
        };
        if (!alive) return;
        setProjectName(d.projectName ?? "");
        setProjectIcon(d.projectIcon ?? "");
        setProjectColor(d.projectColor ?? "");
        setProjectNamed(d.projectNamed !== false);
        setProjectRoot(d.projectRootLabel ?? "");
        setProjectRootAbs(d.projectRoot ?? "");
        setFeatures({ git: !!d.git, repos: !!d.repos, vibeables: !!d.vibeables, projects: !!d.projects });
        setSwitcher(Array.isArray(d.switcher) ? d.switcher : []);
      } catch {}
      if (alive) timer = setTimeout(tick, 30_000);
    };
    void tick();
    // Settings saves dispatch this so header + favicon update immediately.
    const refresh = () => {
      clearTimeout(timer);
      void tick();
    };
    window.addEventListener("kw-meta-refresh", refresh);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("kw-meta-refresh", refresh);
    };
  }, []);
  // Browser-tab title + favicon carry the instance identity so multiple
  // open kraftwerks stay distinguishable (kraftwerk.yml: name, icon).
  useEffect(() => {
    setBaseTitle(projectName ? `${projectName} — kraftwerk` : "kraftwerk inspector");
    if (!projectIcon) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="85">${projectIcon}</text></svg>`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [projectName, projectIcon]);

  const chatSeg = effChat.split("/").filter(Boolean);
  const runsFilter = new URLSearchParams(hash.split("?")[1] ?? "").get("workflow") ?? undefined;
  // The screens the routes already answer, now placed: conversations in the middle column, everything else as a page.
  let chatScreen: React.ReactNode;
  if (chatSeg[0] === "chats") chatScreen = <AgentsScreen seg={chatSeg} />;
  else if (chatSeg[0] === "projects") chatScreen = <ProjectsScreen seg={chatSeg.slice(1)} />;
  else if (chatSeg[0] === "channels") chatScreen = <ChannelsScreen seg={chatSeg.slice(1)} />;
  else chatScreen = <AgentsScreen seg={chatSeg.slice(1)} />;

  let globalScreen: React.ReactNode = null;
  if (seg[0] === "runs" && seg[1]) globalScreen = <RunsScreen id={seg[1]} workflow={runsFilter} />;
  else if (seg[0] === "runs") globalScreen = <LatestRun />;
  else if (seg[0] === "workflows")
    globalScreen = <WorkflowsScreen slug={seg[1] ? decodeURIComponent(seg[1]) : undefined} tab={seg[2] === "details" || seg[2] === "runs" ? seg[2] : "overview"} />;
  else if (seg[0] === "vibeables") globalScreen = <VibeablesScreen slug={seg[1] ? decodeURIComponent(seg[1]) : undefined} />;
  else if (seg[0] === "knowledge") {
    // Concept ids are paths — everything after the bundle segment.
    globalScreen = (
      <KnowledgeScreen
        bundle={seg[1] ? decodeURIComponent(seg[1]) : undefined}
        conceptId={seg.length > 2 ? seg.slice(2).map(decodeURIComponent).join("/") : undefined}
      />
    );
  }
  else if (seg[0] === "skills") globalScreen = <SkillsScreen name={seg[1] ? decodeURIComponent(seg[1]) : undefined} />;
  else if (seg[0] === "settings") globalScreen = <SettingsScreen />;
  else if (seg[0] === "trash") globalScreen = <TrashScreen />;
  else if (seg[0] === "ui") globalScreen = <UiGallery />;
  else if (seg[0] === "files")
    globalScreen = (
      <FilesScreen
        scope={seg[1] ? decodeURIComponent(seg[1]) : "workspace"}
        dir={seg.slice(2).map(decodeURIComponent).join("/")}
        file={new URLSearchParams(hash.split("?")[1] ?? "").get("file") ?? undefined}
      />
    );
  else if (seg[0] === "workspaces") globalScreen = <WorkspacesScreen />;
  else if (seg[0] === "git") globalScreen = <GitScreen />;
  else if (seg[0] === "repos") globalScreen = <ReposScreen slug={seg[1] ? decodeURIComponent(seg[1]) : undefined} />;

  // The workspace colour is the accent: derive the primary roles from it and
  // hand them to the stylesheet ([data-ws-accent] in tokens.css). Set only
  // once the project is known, so the default accent shows until then instead
  // of a colour derived from an empty seed.
  useEffect(() => {
    const el = document.documentElement;
    const seed = projectRootAbs || projectName;
    const pal = seed ? wsPalette(workspaceColor(projectColor, seed)) : null;
    if (!pal) {
      delete el.dataset.wsAccent;
      return;
    }
    for (const [k, v] of Object.entries(pal)) el.style.setProperty(k, v);
    el.dataset.wsAccent = "";
  }, [projectColor, projectRootAbs, projectName]);

  return (
    <>
      {/* topbar: the global nav and the search button still style through it (workspace-tabs.tsx, search.tsx). */}
      <header
        className="topbar sticky top-0 z-10 flex h-[var(--topbar-h)] items-center gap-3.5 bg-bg px-5 shadow-[inset_0_-1px_0_var(--line)] max-[1520px]:gap-2.5 max-[800px]:gap-1.5 max-[800px]:px-3"
        style={{ "--ws-c": workspaceColor(projectColor, projectRootAbs || projectName) } as CSSProperties}
      >
        <span className="flex min-w-0 flex-none items-center gap-2.5 max-[800px]:flex-[0_1_auto] max-[800px]:gap-1">
          <a
            href="#/"
            className="grid size-8 place-items-center rounded-full text-[15px] leading-none transition-shadow hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ws-c,var(--text))_16%,transparent)]"
            title="Dashboard"
          >
            {projectName ? (
              <WorkspaceTile size="sm" icon={projectIcon} name={projectName} color={projectColor} seed={projectRootAbs || projectName} />
            ) : (
              <Icon name="home" />
            )}
          </a>
          {projectName && (
            <WorkspaceSwitcher
              name={projectName}
              icon={projectIcon}
              color={projectColor}
              named={projectNamed}
              root={projectRoot}
              seed={projectRootAbs || projectName}
              entries={switcher}
            />
          )}
        </span>
        <GlobalNav path={path} />
        <span className="flex-[1_1_8px]" />
        <SearchPalette />
        <IconButton icon="settings" label="settings" href="/settings" aria-current={seg[0] === "settings" ? "page" : undefined} />
        <ExpertToggle />
        <NextButton />
        <NotificationBell />
        <RelaunchNote />
      </header>
      {globalScreen && <main className="shell shell-global">{globalScreen}</main>}
      <main
        className={`shell three${isHome ? " home" : ""}`}
        data-focus={focus}
        hidden={!!globalScreen}
        style={ctxW ? ({ "--ctx-w": `${ctxW}px` } as React.CSSProperties) : undefined}
      >
        <ConversationsRail chatPath={isHome ? "/" : effChat} />
        <section className="col-chat" aria-label={isHome ? "Dashboard" : "Conversation"}>
          {isHome ? <DashboardScreen /> : chatScreen}
          <SplitHandle onResize={resizeCtx} />
        </section>
        <ContextPanel chatPath={isHome ? "/" : effChat} workspace={{ name: projectName, icon: projectIcon }} />
        {editScreen && <EditModal back={effChat}>{editScreen}</EditModal>}
      </main>
      {/* Phones show one column at a time; this picks which. */}
      {!globalScreen && (
        <nav className="places" aria-label="Sections">
          <button className={focus === "chat" ? "active" : ""} onClick={() => setFocus("chat")}><Icon name="forum" /> chat</button>
          <button className={focus === "context" ? "active" : ""} onClick={() => setFocus("context")}><Icon name="account_tree" /> context</button>
        </nav>
      )}
    </>
  );
}

/** One workspace-switcher entry (kraftwerk.yml `switcher:` or auto-discovered). */
interface SwitcherEntry {
  name: string;
  url: string;
  icon?: string;
  /** kraftwerk.yml `color`; derived from the root/url when absent. */
  color?: string;
  /** false = the name is just the folder name (no `name:` in kraftwerk.yml). */
  named?: boolean;
  /** true = verified running (probe); false = known project, not running; absent = manual entry. */
  live?: boolean;
  /** Absolute project root (known workspaces only) — the key for start/forget. */
  root?: string;
  /** Root with ~ for home, for display. */
  rootLabel?: string;
  /** false when the root folder is gone (start impossible). */
  exists?: boolean;
}

/** "localhost:2027" → ":2027"; anything else keeps its host. */
function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" ? `:${u.port || (u.protocol === "https:" ? 443 : 80)}` : u.host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

/** A switcher row's second line. */
const SUB = "truncate text-sm text-fg-2 group-aria-[current=true]/ws:text-on-accent-soft group-aria-[current=true]/ws:opacity-80";
/** One row of the switcher: the tile, name and path, then what is on the right. */
const ROW = "group/ws relative flex min-h-[60px] items-center gap-3.5 px-4 py-2.5 text-fg no-underline transition-colors";

/** Path line under a workspace name, left-truncated so the tail stays readable. */
function RootLine({ label }: { label?: string }) {
  if (!label) return null;
  return (
    // Truncated from the left, so the distinguishing tail of the path stays visible.
    <span className={cn(SUB, "[direction:rtl] text-left")} title={label}>
      <span dir="ltr" className="[unicode-bidi:isolate]">{label}</span>
    </span>
  );
}

/** Name line; a folder-derived name is set lighter so it is obvious `name:` is unset. */
function NameLine({ name, named }: { name: string; named?: boolean }) {
  const unnamed = named === false;
  return (
    <span
      className={cn("truncate text-md tracking-[0.2px]", unnamed && "italic text-fg-2", "group-data-[missing]/ws:line-through group-data-[stopped]/ws:text-fg-2")}
      title={unnamed ? `${name} — folder name; set name: in kraftwerk.yml` : name}
    >
      {name}
    </span>
  );
}

/**
 * A known project that is not running: no link, a Start button instead.
 * Start asks this instance to spawn `kraftwerk ui` in the project's root
 * (detached) and follows the link once the new inspector answers.
 */
function StoppedWorkspace({ entry, ambiguous }: { entry: SwitcherEntry; ambiguous: boolean }) {
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const [error, setError] = useState("");
  const missing = entry.exists === false;

  const start = async () => {
    setState("starting");
    setError("");
    try {
      window.location.assign(await startWorkspace(entry.root!));
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  };

  return (
    <span
      className={cn(ROW, "cursor-default")}
      role="menuitem"
      data-stopped=""
      data-missing={missing ? "" : undefined}
      style={{ "--ws-c": workspaceColor(entry.color, entry.root ?? entry.url) } as CSSProperties}
    >
      <WorkspaceTile className="opacity-60 grayscale-50" icon={entry.icon} name={entry.name} color={entry.color} seed={entry.root ?? entry.url} ambiguous={ambiguous} />
      <span className="flex min-w-0 flex-1 flex-col">
        <NameLine name={entry.name} named={entry.named} />
        {state === "error" ? (
          <span className={cn(SUB, "text-bad")} title={error}>{error}</span>
        ) : missing ? (
          <span className={SUB}>folder missing</span>
        ) : (
          <RootLine label={entry.rootLabel} />
        )}
      </span>
      <span className="ml-auto inline-flex flex-none items-center gap-3">
        <Port url={entry.url} />
        <Button
          variant="quiet"
          size="sm"
          icon="play_arrow"
          busy={state === "starting"}
          className="text-accent hover:text-accent"
          disabled={missing}
          title={missing ? "The project folder no longer exists" : "Start the UI for this project"}
          onClick={(e) => {
            e.stopPropagation();
            void start();
          }}
        >
          {state === "starting" ? "starting" : "start"}
        </Button>
      </span>
    </span>
  );
}

/** Where a workspace answers (":2027"), with a green light when it is running. */
function Port({ url, live }: { url: string; live?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-2xs font-medium tracking-[0.5px] text-fg-2">
      {live && <Dot tone="ok" title="running" />}
      {shortHost(url)}
    </span>
  );
}

/** A running or linked workspace: a link to its inspector. */
function LinkedWorkspace({ entry, ambiguous }: { entry: SwitcherEntry; ambiguous: boolean }) {
  const seed = entry.root ?? entry.url;
  return (
    <a
      className={cn(ROW, "hover:bg-surface-2 active:bg-surface-2")}
      role="menuitem"
      href={entry.url}
      style={{ "--ws-c": workspaceColor(entry.color, seed) } as CSSProperties}
    >
      <WorkspaceTile icon={entry.icon} name={entry.name} color={entry.color} seed={seed} ambiguous={ambiguous} />
      <span className="flex min-w-0 flex-1 flex-col">
        <NameLine name={entry.name} named={entry.named} />
        <RootLine label={entry.rootLabel ?? (entry.root ? undefined : entry.url.replace(/^https?:\/\//, ""))} />
      </span>
      <span className="ml-auto inline-flex flex-none items-center gap-3">
        <Port url={entry.url} live={entry.live} />
      </span>
    </a>
  );
}

/**
 * The workspace name in the header. Becomes a dropdown when other
 * workspaces are known — running local instances are discovered
 * automatically (~/.kraftwerk/instances), workspaces that ran before are
 * remembered (~/.kraftwerk/workspaces) and can be started from here, and
 * `switcher:` entries in kraftwerk.yml add manual/remote ones. Plain label
 * otherwise. Rows are grouped running / stopped / linked, each carries
 * its workspace colour (rail + tile) and its root path, so which is
 * which is readable without memorising ports.
 */
function WorkspaceSwitcher({
  name,
  icon,
  color,
  named,
  root,
  seed,
  entries,
}: {
  name: string;
  icon: string;
  color: string;
  named: boolean;
  /** Root with ~ for display. */
  root: string;
  /** Absolute root: the colour seed, the same one other instances hash. */
  seed: string;
  entries: SwitcherEntry[];
}) {
  const [open, setOpen] = useState(false);
  const expert = useExpertMode();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-switcher]")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  // An emoji shared by two listed workspaces (this one included) is no
  // identifier — those tiles get the monogram badge.
  const iconCount = new Map<string, number>();
  for (const i of [icon, ...entries.map((e) => e.icon)]) if (i) iconCount.set(i, (iconCount.get(i) ?? 0) + 1);
  const ambiguous = (i?: string) => !!i && (iconCount.get(i) ?? 0) > 1;

  const groups: { key: string; label: string; items: SwitcherEntry[] }[] = [
    { key: "running", label: "running", items: entries.filter((e) => e.live === true) },
    { key: "stopped", label: "stopped", items: entries.filter((e) => e.live === false) },
    { key: "linked", label: "linked", items: entries.filter((e) => e.live === undefined) },
  ].filter((g) => g.items.length > 0);
  const selfSeed = seed || name;

  return (
    <span className="relative inline-flex min-w-0" data-switcher="">
      <button
        type="button"
        // env-switch: the tests open the workspace menu by it.
        className="env-switch inline-flex max-w-[220px] min-w-0 cursor-pointer items-center gap-[5px] rounded-xl border-0 bg-transparent px-2 py-1 font-[inherit] text-[15px] font-bold tracking-[0.02em] whitespace-nowrap text-fg transition-colors hover:bg-surface-2 max-[1520px]:max-w-[250px]"
        title={root ? `${root} — workspace menu` : "Workspace menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 truncate">{name}</span>
        <Icon name="expand_more" className="flex-none opacity-55" />
      </button>
      {open && (
        <div
          className="absolute top-[calc(100%+8px)] left-0 z-20 max-h-[calc(100dvh-120px)] max-w-[min(480px,92vw)] min-w-[360px] max-[800px]:fixed max-[800px]:inset-x-2 max-[800px]:top-[calc(var(--topbar-h)-4px)] max-[800px]:max-w-none max-[800px]:min-w-0 overflow-y-auto overscroll-contain rounded-card border border-line bg-surface py-2 shadow-pop"
          role="menu"
        >
          {entries.length > 0 && <Eyebrow className="block px-4 pt-1 pb-2">workspaces</Eyebrow>}
          <span
            className={cn(ROW, "cursor-default bg-accent-soft text-on-accent-soft")}
            aria-current="true"
            style={{ "--ws-c": workspaceColor(color, selfSeed) } as CSSProperties}
          >
            <WorkspaceTile icon={icon} name={name} color={color} seed={selfSeed} ambiguous={ambiguous(icon)} />
            <span className="flex min-w-0 flex-1 flex-col">
              <NameLine name={name} named={named} />
              {root ? <RootLine label={root} /> : <span className={SUB}>this workspace</span>}
            </span>
            <span className="ml-auto inline-flex flex-none items-center gap-3">
              <Icon name="check" className="text-[24px] text-on-accent-soft" />
            </span>
          </span>
          {groups.map((g) => (
            <div key={g.key} className="mt-2 border-t border-line pt-1" role="group" aria-label={g.label}>
              <Eyebrow className="block px-4 pt-2 pb-1">{g.label}</Eyebrow>
              {g.items.map((e) =>
                e.live === false && e.root ? (
                  <StoppedWorkspace key={e.root} entry={e} ambiguous={ambiguous(e.icon)} />
                ) : (
                  <LinkedWorkspace key={e.root ?? e.url} entry={e} ambiguous={ambiguous(e.icon)} />
                )
              )}
            </div>
          ))}
          {expert && entries.length > 0 && (
            <a
              className="mt-2 flex min-h-12 items-center gap-4 border-t border-line px-4 text-md text-fg no-underline transition-colors hover:bg-surface-2"
              href="#/workspaces"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <Icon name="hub" className="text-[22px] text-fg-2" /> manage workspaces
            </a>
          )}
          <WorkspaceMenu onClose={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

/** The runs screen lives at #/runs/<id>; #/runs lands on the latest run. */
function LatestRun() {
  const [empty, setEmpty] = useState<{ outputDir: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data: { outputDir: string; runs: RunListItem[] }) => {
        if (!alive) return;
        if (data.runs.length > 0) navigate(`/runs/${data.runs[0].id}`, { replace: true });
        else setEmpty({ outputDir: data.outputDir });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!empty) return <EmptyState>loading…</EmptyState>;
  return (
    <EmptyState icon="play_circle">
      No runs found in <code>{empty.outputDir}</code>. Start one from the{" "}
      <a href="#/workflows" className="text-accent">workflows</a> list or with <code>kraftwerk run &lt;workflow&gt; [request]</code>.
    </EmptyState>
  );
}

/**
 * "vX ready — relaunch": shown when a newer install landed on disk while
 * this server keeps running the old code (npm upgrade, dev release). Click
 * restarts the supervised server (POST /api/restart), waits for the new
 * version to answer, then reloads the page.
 */
/** Restart the supervised server and reload once it answers with `target`. */
async function relaunchTo(target: string): Promise<void> {
  await fetch("/api/restart", { method: "POST" }).catch(() => {});
  // Wait until the respawned server answers with the on-disk version.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const d = await fetch("/api/meta", { cache: "no-store" }).then((r) => r.json());
      if (d.version === target) break;
    } catch {}
  }
  location.reload();
}

/** Fired by the self-update when a new version landed on disk, so the pill shows at once. */
const VERSION_EVENT = "kw-version-changed";

function RelaunchNote() {
  const [meta, setMeta] = useState<{
    version: string;
    diskVersion?: string;
    restartable?: boolean;
  } | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      clearTimeout(timer);
      try {
        const d = await fetch("/api/meta", { cache: "no-store" }).then((r) => r.json());
        if (alive) setMeta(d);
      } catch {}
      if (alive) timer = setTimeout(tick, 30_000);
    };
    void tick();
    const onChange = () => void tick();
    window.addEventListener(VERSION_EVENT, onChange);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(VERSION_EVENT, onChange);
    };
  }, []);

  const target =
    meta?.restartable && meta.diskVersion && meta.diskVersion !== meta.version
      ? meta.diskVersion
      : null;

  async function relaunch(): Promise<void> {
    if (!target) return;
    setRestarting(true);
    await relaunchTo(target);
  }

  if (!target && !restarting) return null;
  return (
    <button
      type="button"
      className="mr-2.5 inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border border-accent bg-accent/10 px-3 py-1 font-[inherit] text-xs text-accent hover:bg-accent/18 disabled:cursor-default disabled:opacity-70"
      disabled={restarting}
      title={`v${target} is installed on disk, the server still runs v${meta?.version}. Click to relaunch with the new version.`}
      onClick={() => void relaunch()}
    >
      {restarting ? "relaunching…" : <><Icon name="restart_alt" className="ms-sm" /> v{target} ready — relaunch</>}
    </button>
  );
}

/**
 * Expert mode switch: on = the full view, off = radically simplified UI
 * (tool activity collapses to "working…", harness/paths hidden).
 */
function ExpertToggle() {
  const on = useExpertMode();
  return (
    <button
      type="button"
      // expert-toggle: the tests flip the mode by it.
      className={cn(
        "expert-toggle inline-flex cursor-pointer items-center gap-[7px] rounded-full border-0 bg-transparent px-2 py-1 font-mono text-2xs tracking-[0.5px] transition-colors hover:text-fg",
        on ? "text-fg" : "text-fg-2"
      )}
      title={on ? "Expert mode on — full detail" : "Expert mode off — simplified view"}
      aria-pressed={on}
      onClick={() => setExpertMode(!on)}
    >
      <span className={cn("relative h-[15px] w-[26px] rounded-full transition-colors", on ? "bg-accent" : "bg-fg/14")}>
        <span className={cn("absolute top-0.5 size-[11px] rounded-full transition-[left,background-color]", on ? "left-[13px] bg-on-accent" : "left-0.5 bg-surface")} />
      </span>
      <span className="max-[640px]:hidden">expert</span>
    </button>
  );
}

const NOTIF_ICON: Record<NotificationKind, string> = {
  approval: "gavel",
  routine_done: "schedule",
  routine_failed: "schedule",
  run_done: "account_tree",
  run_failed: "account_tree",
};

const NOTIF_TOAST_DISMISSED = "kw.notif.toast.dismissed";

/**
 * The bell: attention items (a session waiting for approval, a routine or
 * run that ended). Unread count on the badge and in the tab title; a browser
 * notification for each new item while the tab is open but not looking at
 * that very page. The list itself comes from /api/notifications.
 */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const data = usePoll<NotificationsView>("/api/notifications", false, 5000);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [toastDismissed, setToastDismissed] = useState(() => {
    try {
      return localStorage.getItem(NOTIF_TOAST_DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  const seen = useRef<Set<string> | null>(null);
  // Actions (read, clear) answer with the fresh view: show it at once and
  // let the next poll take over again.
  const [fresh, setFresh] = useState<NotificationsView | null>(null);
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  useEffect(() => setFresh(null), [data]);
  const view = fresh ?? data;
  const items = view?.items ?? [];
  // Needs you: what blocks an agent (live requests) and failures nobody opened yet. The count and the title follow it.
  const needs = useAttention() ?? [];
  const needIds = new Set(needs.map((i) => i.notificationId).filter(Boolean));
  // Updates: everything else the bell keeps — finished runs and routines, failures already seen. Approvals live in "needs you".
  const updates = items.filter((n) => n.kind !== "approval" && !needIds.has(n.id));
  const unreadUpdates = updates.filter((n) => !n.readAt).length;
  const unread = needs.length;

  useEffect(() => setAttentionCount(needs.length), [needs.length]);

  // Browser notifications: the first poll seeds "seen" silently (no toast
  // storm for history); afterwards every new unread item that is not the
  // page currently on screen gets one. Clicking it opens the item.
  useEffect(() => {
    if (!data) return;
    if (!seen.current) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    for (const n of items) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.readAt || perm !== "granted") continue;
      if (!document.hidden && location.hash === `#${n.href}`) continue;
      try {
        const toast = new Notification(n.title, { body: n.body, tag: n.id });
        toast.onclick = () => {
          window.focus();
          openItem(n);
          toast.close();
        };
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-bell]")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function post(url: string, body?: unknown): Promise<void> {
    try {
      const r = await fetch(url, {
        method: url.endsWith("/notifications") ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) return;
      const d = (await r.json()) as NotificationsView | { ok: true };
      setFresh("items" in d ? d : { items: [], unread: 0 });
    } catch {}
  }

  function openItem(n: Notification): void {
    setOpen(false);
    if (!n.readAt) void post("/api/notifications/read", { ids: [n.id] });
    navigate(n.href);
  }

  /** Failure items: open a chat that investigates and fixes the cause. */
  async function diagnose(n: Notification): Promise<void> {
    setDiagnosing(n.id);
    try {
      const r = await fetch(`/api/notifications/${encodeURIComponent(n.id)}/diagnose`, { method: "POST" });
      const d = (await r.json()) as { href?: string; error?: string };
      if (d.href) {
        setOpen(false);
        navigate(d.href);
      } else if (d.error) {
        alert(d.error);
      }
    } catch {}
    setDiagnosing(null);
  }

  async function enableToasts(): Promise<void> {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  }

  function dismissToastHint(): void {
    setToastDismissed(true);
    try {
      localStorage.setItem(NOTIF_TOAST_DISMISSED, "1");
    } catch {}
  }

  const showToastHint = perm === "default" && !toastDismissed;
  return (
    <span className="relative inline-flex" data-bell="">
      <button
        type="button"
        className={cn(
          "relative grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent transition-colors hover:bg-surface-2 hover:text-fg",
          unread ? "text-fg" : "text-fg-2"
        )}
        title={unread ? `${unread} thing${unread === 1 ? "" : "s"} waiting for you` : unreadUpdates ? `${unreadUpdates} update${unreadUpdates === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={unread ? "notifications_active" : "notifications"} />
        {/* What waits is counted on "next"; the bell only marks unread updates. */}
        {unreadUpdates > 0 && <span className="absolute top-1.5 right-1.5 size-[7px] rounded-full bg-accent" />}
      </button>
      {open && (
        <div className="notif-pop absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[min(80dvh,640px)] w-[min(460px,92vw)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop" role="menu">
          <div className="flex items-center gap-1 border-b border-line px-4 py-2">
            <Eyebrow className="text-fg">notifications</Eyebrow>
            <span className="flex-1" />
            {unreadUpdates > 0 && (
              <Button variant="quiet" size="sm" onClick={() => void post("/api/notifications/read", { ids: updates.filter((n) => !n.readAt).map((n) => n.id) })}>
                mark updates read
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="quiet" size="sm" onClick={() => void post("/api/notifications")}>
                clear
              </Button>
            )}
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain pb-1.5">
            {showToastHint && (
              <div className="m-2 flex flex-col gap-2 rounded-control bg-surface-2 p-3 text-sm">
                <span>Get a system notification when something needs you, even with this tab in the background.</span>
                <span className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => void enableToasts()}>enable</Button>
                  <Button variant="quiet" size="sm" onClick={dismissToastHint}>not now</Button>
                </span>
              </div>
            )}
            {perm === "denied" && (
              <p className="m-0 px-4 pt-2 text-xs text-fg-2">Browser notifications are blocked for this site — allow them in the address bar to get system alerts.</p>
            )}
            <Section title="needs you" count={needs.length || undefined} className="px-1.5 pt-1.5">
              {needs.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-sm text-fg-2">nothing is waiting for you</p>
              ) : (
                groupByOwner(needs).map(([owner, group]) => (
                  <div key={owner}>
                    <div className="notif-owner px-2.5 pb-0.5 pt-2 text-xs font-semibold text-fg">{owner}</div>
                    {group.map((i) => {
                      const n = i.notificationId ? items.find((x) => x.id === i.notificationId) : undefined;
                      return (
                        <ListRow
                          key={i.id}
                          className="notif-row need"
                          onClick={() => {
                            setOpen(false);
                            openAttention(i);
                          }}
                          leading={<Icon name={i.kind === "approval" ? "front_hand" : i.kind === "question" ? "help" : "error"} className="ms-sm text-bad" />}
                          title={i.title}
                          sub={`${i.kind === "approval" ? "needs approval" : i.kind === "question" ? "asks you" : "failed"}${i.chatTitle ? ` · in ${i.chatTitle}` : ""}`}
                          meta={fmtAgo(i.since)}
                          actionsAlways
                          actions={n?.diagnose ? <DiagnoseButton busy={diagnosing === n.id} onClick={() => void diagnose(n)} /> : undefined}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </Section>
            <Section title="updates" className="px-1.5 pt-1.5">
              {updates.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-sm text-fg-2">no updates</p>
              ) : (
                updates.slice(0, 50).map((n) => (
                  <ListRow
                    key={n.id}
                    className={cn("notif-row", !n.readAt && "bg-accent/5")}
                    onClick={() => openItem(n)}
                    leading={<Icon name={NOTIF_ICON[n.kind]} className={cn("ms-sm", n.kind.endsWith("failed") ? "text-bad" : n.kind.endsWith("done") ? "text-ok" : "")} />}
                    title={n.title}
                    sub={n.body}
                    meta={fmtAgo(n.at)}
                    actionsAlways
                    actions={n.diagnose ? <DiagnoseButton busy={diagnosing === n.id} onClick={() => void diagnose(n)} /> : undefined}
                  />
                ))
              )}
            </Section>
          </div>
        </div>
      )}
    </span>
  );
}

/** A failure's way out: a chat that finds the cause and proposes the fix. */
function DiagnoseButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="troubleshoot"
      busy={busy}
      title="Open a chat that finds the cause and proposes the fix"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {busy ? "starting…" : "diagnose"}
    </Button>
  );
}

/** "Needs you" items grouped by whose they are, the group waiting longest first. */
function groupByOwner(xs: AttentionItem[]): Array<[string, AttentionItem[]]> {
  const groups = new Map<string, AttentionItem[]>();
  for (const i of xs) {
    const k = ownerText(i.owner);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.entries()];
}

/** Project facts behind an ⓘ icon: dirs, workflow + run counts. */
/**
 * The workspace menu's own part (under the workspace switcher): the theme,
 * the trash, and which kraftwerk runs it. What sat in the top bar as the ⓘ
 * popover; the expert switch and settings sit beside the search.
 */
function WorkspaceMenu({ onClose }: { onClose: () => void }) {
  const expert = useExpertMode();
  const [runs, setRuns] = useState<{ outputDir: string; runs: RunListItem[] } | null>(null);
  const [wfs, setWfs] = useState<{ root: string; workflows: unknown[] } | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { version: string }) => setVersion(d.version))
      .catch(() => {});
    if (!expert) return;
    fetch("/api/runs").then((r) => r.json()).then(setRuns).catch(() => {});
    fetch("/api/workflows").then((r) => r.json()).then(setWfs).catch(() => {});
  }, [expert]);
  return (
    <div className="ws-menu mt-1.5 flex flex-col gap-0.5 border-t border-line px-1.5 pb-1 pt-2">
      <MenuLine label="Theme"><ThemeToggle /></MenuLine>
      <div className="flex gap-1 px-1">
        <Button variant="quiet" size="sm" icon="delete" href="/trash" onClick={onClose}>trash</Button>
      </div>
      {expert && (
        <div className="flex flex-col gap-1 px-2.5 py-1.5 text-xs">
          <div><Eyebrow>Workflows</Eyebrow> {wfs ? `${wfs.workflows.length} discovered` : "…"} <code className="block break-all text-2xs text-fg-2" title={wfs?.root}>{wfs?.root ?? ""}</code></div>
          <div><Eyebrow>Runs</Eyebrow> {runs ? `${runs.runs.length} total` : "…"} <code className="block break-all text-2xs text-fg-2" title={runs?.outputDir}>{runs?.outputDir ?? ""}</code></div>
        </div>
      )}
      <MenuLine label={<span className="font-mono">{version ? `kraftwerk ${version}` : "…"}</span>}>
        <UpdateCheck />
      </MenuLine>
    </div>
  );
}

/** One line of the workspace menu: what it is on the left, its control on the right. */
function MenuLine({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
      <span className="text-sm text-fg-2">{label}</span>
      {children}
    </div>
  );
}

function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/**
 * "check for updates" asks the server to query the npm registry; a newer
 * version gets an "update now" that runs `npm i -g` through the server
 * (POST /api/update) with its output shown here, then hands over to the
 * relaunch. Where the server refuses (container, global folder not
 * writable) the command is shown to run by hand, as before.
 */
function UpdateCheck() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  const [info, setInfo] = useState<{ name: string; current: string; latest: string } | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [refused, setRefused] = useState("");
  const [relaunching, setRelaunching] = useState(false);

  async function check(): Promise<void> {
    setState("busy");
    try {
      const r = await fetch("/api/update-check", { cache: "no-store" });
      const d = (await r.json()) as { name: string; current: string; latest: string };
      if (!r.ok || !d.latest) throw new Error();
      setInfo(d);
      setState("done");
    } catch {
      setState("err");
    }
  }

  // Follow a running install until it ends; then tell the relaunch pill.
  const running = job?.state === "running";
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const d = (await fetch("/api/update", { cache: "no-store" }).then((r) => r.json())) as UpdateJob;
        if (!alive) return;
        setJob(d);
        if (d.state !== "running") window.dispatchEvent(new Event(VERSION_EVENT));
      } catch {}
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running]);

  async function install(): Promise<void> {
    if (!info) return;
    setRefused("");
    const r = await fetch("/api/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: info.latest }),
    });
    const d = (await r.json()) as UpdateJob & { error?: string };
    if (!r.ok) setRefused(d.error ?? "update refused");
    else setJob(d);
  }

  if (job && job.state !== "idle" && info) {
    const last = job.log[job.log.length - 1] ?? "";
    if (job.state === "running")
      return (
        <span className={cn(RESULT, "basis-full flex-wrap")}>
          <Icon name="progress_activity" className="ms-sm" /> installing v{info.latest}…
          {last && <code className="max-w-full truncate text-2xs text-fg-2" title={job.log.join("\n")}>{last}</code>}
        </span>
      );
    if (job.state === "done")
      return (
        <span className={cn(RESULT, NEWER)}>
          v{info.latest} installed —{" "}
          {job.restartable ? (
            <Button size="sm" icon="restart_alt" busy={relaunching} onClick={() => { setRelaunching(true); void relaunchTo(info.latest); }}>
              {relaunching ? "relaunching…" : "relaunch"}
            </Button>
          ) : (
            <>restart <code>kraftwerk ui</code> to use it</>
          )}
        </span>
      );
    return (
      <span className={cn(RESULT, "basis-full flex-wrap text-bad")} title={job.log.join("\n")}>
        <Icon name="error" className="ms-sm" /> install failed{last ? ` — ${last}` : ""} · <code>npm i -g {info.name}@latest</code>
      </span>
    );
  }

  if (state === "done" && info) {
    const newer = semverLt(info.current, info.latest);
    return newer ? (
      <span className={cn(RESULT, NEWER)}>
        v{info.latest} available —{" "}
        {refused ? (
          <>
            <span className="font-normal text-fg-2" title={refused}>{refused}</span> · <code className="text-2xs">npm i -g {info.name}@latest</code>
          </>
        ) : (
          <Button size="sm" icon="download" onClick={() => void install()}>
            update now
          </Button>
        )}
      </span>
    ) : (
      <span className={RESULT}>
        <Icon name="check" className="ms-sm text-ok" /> up to date
      </span>
    );
  }
  return (
    <Button size="sm" icon={state === "busy" || state === "err" ? undefined : "sync"} disabled={state === "busy"} onClick={() => void check()}>
      {state === "busy" ? "checking…" : state === "err" ? "npm unreachable — retry" : "check for updates"}
    </Button>
  );
}

/** How the update check reads: a small line; a newer version takes the whole row in the accent. */
const RESULT = "inline-flex items-center gap-[5px] text-xs text-fg-2";
const NEWER = "basis-full flex-wrap font-medium text-accent";

interface UpdateJob {
  state: "idle" | "running" | "done" | "failed";
  version?: string;
  log: string[];
  exitCode?: number | null;
  restartable?: boolean;
}

function ThemeToggle() {
  return (
    <Button
      size="sm"
      icon="contrast"
      onClick={() => {
        const el = document.documentElement;
        const next = el.dataset.theme === "light" ? "dark" : "light";
        el.dataset.theme = next;
        try {
          localStorage.setItem("kw-theme", next);
        } catch {}
      }}
    >
      day / night
    </Button>
  );
}
