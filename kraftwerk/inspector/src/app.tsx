import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import type { GitStatus, RunListItem } from "./types";
import { Icon, navigate, setBaseTitle, setExpertMode, startWorkspace, useExpertMode, useHashPath, usePoll, workspaceColor, WorkspaceTile } from "./shared";
// Editor (MDXEditor + CodeMirror) is heavy — only loaded on the /edit route.
const EditorScreen = lazy(() => import("./editor").then((m) => ({ default: m.EditorScreen })));
import { RunsScreen } from "./runs";
import { WorkflowIndex } from "./workflows";
import { WorkflowView } from "./workflow-view";
import { DashboardScreen } from "./dashboard";
import { KnowledgeScreen } from "./knowledge";
import { SkillsScreen } from "./skills";
import { AgentsScreen } from "./agents";
import { SettingsScreen } from "./settings";
import { WorkspacesScreen } from "./workspaces";
import { GitScreen } from "./git";
import { ReposScreen } from "./repos";
import { SearchPalette } from "./search";

/**
 * Shell + hash router. Routes: #/ (dashboard), #/runs (redirect to latest
 * run), #/runs/<id>, #/workflows, #/workflows/<slug>,
 * #/knowledge[/<bundle>[/<concept-path>]], #/skills[/<name>],
 * #/agents[/new | /chats[/<chatId>] | /<slug>[/info | /edit | /chat/<chatId>]],
 * #/repos, #/git, #/settings, #/workspaces.
 * A bare #/agents/<slug> opens the agent's most recent session; the profile
 * lives at /info. Legacy #/team/* and #/chats[/<id>] links still land here.
 * ⌘K opens the agent palette (search.tsx) from anywhere.
 */
export function App() {
  const path = useHashPath();
  const seg = path.split("/").filter(Boolean);
  const [projectName, setProjectName] = useState("");
  const [projectIcon, setProjectIcon] = useState("");
  const [projectColor, setProjectColor] = useState("");
  const [projectNamed, setProjectNamed] = useState(true);
  const [projectRoot, setProjectRoot] = useState("");
  const [projectRootAbs, setProjectRootAbs] = useState("");
  const [gitOn, setGitOn] = useState(false);
  const [reposOn, setReposOn] = useState(false);
  const [switcher, setSwitcher] = useState<SwitcherEntry[]>([]);
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
          switcher?: SwitcherEntry[];
        };
        if (!alive) return;
        setProjectName(d.projectName ?? "");
        setProjectIcon(d.projectIcon ?? "");
        setProjectColor(d.projectColor ?? "");
        setProjectNamed(d.projectNamed !== false);
        setProjectRoot(d.projectRootLabel ?? "");
        setProjectRootAbs(d.projectRoot ?? "");
        setGitOn(!!d.git);
        setReposOn(!!d.repos);
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

  let screen: React.ReactNode;
  if (seg[0] === "runs" && seg[1]) screen = <RunsScreen id={seg[1]} />;
  else if (seg[0] === "runs") screen = <LatestRun />;
  else if (seg[0] === "workflows" && seg[1]) screen = <WorkflowView slug={decodeURIComponent(seg[1])} />;
  else if (seg[0] === "workflows") screen = <WorkflowIndex />;
  else if (seg[0] === "chats") screen = <AgentsScreen seg={seg} />;
  else if (seg[0] === "skills") screen = <SkillsScreen name={seg[1] ? decodeURIComponent(seg[1]) : undefined} />;
  else if (seg[0] === "settings") screen = <SettingsScreen />;
  else if (seg[0] === "workspaces") screen = <WorkspacesScreen />;
  else if (seg[0] === "git") screen = <GitScreen />;
  else if (seg[0] === "repos") screen = <ReposScreen />;
  else if (seg[0] === "agents" || seg[0] === "team") screen = <AgentsScreen seg={seg.slice(1)} />;
  else if (seg[0] === "knowledge") {
    // Concept ids are paths — everything after the bundle segment.
    screen = (
      <KnowledgeScreen
        bundle={seg[1] ? decodeURIComponent(seg[1]) : undefined}
        conceptId={seg.length > 2 ? seg.slice(2).map(decodeURIComponent).join("/") : undefined}
      />
    );
  } else screen = <DashboardScreen />;

  // Document editor mode: nothing but the editor.
  if (seg[0] === "edit" && seg[1] && seg.length > 2) {
    return (
      <Suspense fallback={<div className="empty">loading editor…</div>}>
        <EditorScreen
          key={seg.slice(1).join("/")}
          bundle={decodeURIComponent(seg[1])}
          conceptId={seg.slice(2).map(decodeURIComponent).join("/")}
        />
      </Suspense>
    );
  }

  return (
    <>
      <header className="topbar" style={{ "--ws-c": workspaceColor(projectColor, projectRootAbs || projectName) } as CSSProperties}>
        <span className="wordmark">
          <a href="#/" className="home-link" title="Dashboard">
            {projectName ? (
              <WorkspaceTile className="home-tile" icon={projectIcon} name={projectName} color={projectColor} seed={projectRootAbs || projectName} />
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
        <nav>
          <a href="#/agents"><Icon name="groups" /> agents</a>
          <a href="#/knowledge"><Icon name="menu_book" /> context &amp; knowledge</a>
          <a href="#/workflows"><Icon name="account_tree" /> workflows</a>
          <a href="#/runs"><Icon name="history" /> workflow runs</a>
          <a href="#/skills"><Icon name="extension" /> skills</a>
          {reposOn && <a href="#/repos"><Icon name="source" /> repositories</a>}
          {gitOn && <GitNavLink />}
        </nav>
        <span className="spacer" />
        <SearchPalette />
        <RelaunchNote />
        <ExpertToggle />
        <ProjectInfo />
      </header>
      <main className="shell">{screen}</main>
    </>
  );
}

/**
 * Nav entry for the git screen, shown only when kraftwerk.yml turns the
 * feature on. Carries the ahead/behind counts so the state is visible
 * without opening the screen.
 */
function GitNavLink() {
  const st = usePoll<GitStatus>("/api/git", false, 15_000);
  const dirty = st?.files?.filter((f) => f.syncable).length ?? 0;
  return (
    <a href="#/git">
      <Icon name="cloud_sync" /> git
      {!!st?.behind && <span className="git-badge behind">{st.behind}↓</span>}
      {!!st?.ahead && <span className="git-badge ahead">{st.ahead}↑</span>}
      {!st?.ahead && !st?.behind && !!dirty && <span className="git-badge dirty">{dirty}</span>}
    </a>
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
  /** Absolute project root (known projects only) — the key for start/forget. */
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

/** Path line under a workspace name, left-truncated so the tail stays readable. */
function RootLine({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="switcher-root" title={label}>
      <span dir="ltr">{label}</span>
    </span>
  );
}

/** Name line; a folder-derived name is set lighter so it is obvious `name:` is unset. */
function NameLine({ name, named }: { name: string; named?: boolean }) {
  const unnamed = named === false;
  return (
    <span
      className={`switcher-name${unnamed ? " unnamed" : ""}`}
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
      className={`switcher-item stopped ${missing ? "missing" : ""}`}
      role="menuitem"
      style={{ "--ws-c": workspaceColor(entry.color, entry.root ?? entry.url) } as CSSProperties}
    >
      <WorkspaceTile icon={entry.icon} name={entry.name} color={entry.color} seed={entry.root ?? entry.url} ambiguous={ambiguous} />
      <span className="switcher-text">
        <NameLine name={entry.name} named={entry.named} />
        {state === "error" ? (
          <span className="switcher-sub switcher-err" title={error}>{error}</span>
        ) : missing ? (
          <span className="switcher-sub">folder missing</span>
        ) : (
          <RootLine label={entry.rootLabel} />
        )}
      </span>
      <span className="switcher-side">
        <span className="switcher-port">{shortHost(entry.url)}</span>
        <button
          className="switcher-start"
          disabled={missing || state === "starting"}
          title={missing ? "The project folder no longer exists" : "Start the UI for this project"}
          onClick={(e) => {
            e.stopPropagation();
            void start();
          }}
        >
          {state === "starting" ? <Icon name="progress_activity" /> : <Icon name="play_arrow" />}
          {state === "starting" ? "starting" : "start"}
        </button>
      </span>
    </span>
  );
}

/** A running or linked workspace: a link to its inspector. */
function LinkedWorkspace({ entry, ambiguous }: { entry: SwitcherEntry; ambiguous: boolean }) {
  const seed = entry.root ?? entry.url;
  return (
    <a
      className={`switcher-item${entry.live ? " live" : ""}`}
      role="menuitem"
      href={entry.url}
      style={{ "--ws-c": workspaceColor(entry.color, seed) } as CSSProperties}
    >
      <WorkspaceTile icon={entry.icon} name={entry.name} color={entry.color} seed={seed} ambiguous={ambiguous} />
      <span className="switcher-text">
        <NameLine name={entry.name} named={entry.named} />
        <RootLine label={entry.rootLabel ?? (entry.root ? undefined : entry.url.replace(/^https?:\/\//, ""))} />
      </span>
      <span className="switcher-side">
        <span className="switcher-port">
          {entry.live && <span className="live-dot" title="running" />}
          {shortHost(entry.url)}
        </span>
      </span>
    </a>
  );
}

/**
 * The workspace name in the header. Becomes a dropdown when other
 * workspaces are known — running local instances are discovered
 * automatically (~/.kraftwerk/instances), projects that ran before are
 * remembered (~/.kraftwerk/projects) and can be started from here, and
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
      if (!(e.target as HTMLElement).closest(".switcher-wrap")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (entries.length === 0) {
    return <span className="env-name" title={root || "Project (kraftwerk.yml: name)"}>{name}</span>;
  }

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
    <span className="switcher-wrap">
      <button
        className="env-name env-switch"
        title={root ? `${root} — switch workspace` : "Switch workspace"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {name}
        <Icon name="expand_more" />
      </button>
      {open && (
        <div className="switcher-pop" role="menu">
          <div className="switcher-head">Workspaces</div>
          <span
            className="switcher-item current"
            aria-current="true"
            style={{ "--ws-c": workspaceColor(color, selfSeed) } as CSSProperties}
          >
            <WorkspaceTile icon={icon} name={name} color={color} seed={selfSeed} ambiguous={ambiguous(icon)} />
            <span className="switcher-text">
              <NameLine name={name} named={named} />
              {root ? <RootLine label={root} /> : <span className="switcher-sub">this workspace</span>}
            </span>
            <span className="switcher-side">
              <Icon name="check" className="switcher-check" />
            </span>
          </span>
          {groups.map((g) => (
            <div key={g.key} className={`switcher-group switcher-group-${g.key}`} role="group" aria-label={g.label}>
              <div className="switcher-group-head">{g.label}</div>
              {g.items.map((e) =>
                e.live === false && e.root ? (
                  <StoppedWorkspace key={e.root} entry={e} ambiguous={ambiguous(e.icon)} />
                ) : (
                  <LinkedWorkspace key={e.root ?? e.url} entry={e} ambiguous={ambiguous(e.icon)} />
                )
              )}
            </div>
          ))}
          {expert && (
            <a className="switcher-foot" href="#/workspaces" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="hub" /> manage workspaces
            </a>
          )}
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
  if (!empty) return <div className="empty">loading…</div>;
  return (
    <div className="empty">
      No runs found in <code>{empty.outputDir}</code>. Start one with{" "}
      <code>kraftwerk run &lt;workflow&gt; &lt;request&gt;</code> or from a workflow page.
    </div>
  );
}

/**
 * "vX ready — relaunch": shown when a newer install landed on disk while
 * this server keeps running the old code (npm upgrade, dev release). Click
 * restarts the supervised server (POST /api/restart), waits for the new
 * version to answer, then reloads the page.
 */
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
      try {
        const d = await fetch("/api/meta", { cache: "no-store" }).then((r) => r.json());
        if (alive) setMeta(d);
      } catch {}
      if (alive) timer = setTimeout(tick, 30_000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const target =
    meta?.restartable && meta.diskVersion && meta.diskVersion !== meta.version
      ? meta.diskVersion
      : null;

  async function relaunch(): Promise<void> {
    if (!target) return;
    setRestarting(true);
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

  if (!target && !restarting) return null;
  return (
    <button
      className="relaunch-note"
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
      className={`expert-toggle ${on ? "on" : ""}`}
      title={on ? "Expert mode on — full detail" : "Expert mode off — simplified view"}
      aria-pressed={on}
      onClick={() => setExpertMode(!on)}
    >
      <span className="expert-track">
        <span className="expert-knob" />
      </span>
      expert
    </button>
  );
}

/** Project facts behind an ⓘ icon: dirs, workflow + run counts. */
function ProjectInfo() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<{ outputDir: string; runs: RunListItem[] } | null>(null);
  const [wfs, setWfs] = useState<{ root: string; workflows: unknown[] } | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/runs").then((r) => r.json()).then(setRuns).catch(() => {});
    fetch("/api/workflows").then((r) => r.json()).then(setWfs).catch(() => {});
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { version: string }) => setVersion(d.version))
      .catch(() => {});
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".info-wrap")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const latest = runs?.runs[0];
  return (
    <span className="info-wrap">
      <button
        className="info-btn"
        title="Project info"
        aria-label="Project info"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" />
      </button>
      {open && (
        <div className="info-pop">
          <div className="info-row">
            <span className="microlabel">Workflows</span>
            <span className="info-v">{wfs ? `${wfs.workflows.length} discovered` : "…"}</span>
            <code className="info-path" title={wfs?.root}>{wfs?.root ?? ""}</code>
          </div>
          <div className="info-row">
            <span className="microlabel">Runs</span>
            <span className="info-v">
              {runs ? `${runs.runs.length} total` : "…"}
              {latest ? ` · latest ${latest.status}` : ""}
            </span>
            <code className="info-path" title={runs?.outputDir}>{runs?.outputDir ?? ""}</code>
          </div>
          <div className="info-row info-actions">
            <span className="microlabel">Workspace</span>
            <a className="update-btn" href="#/settings" onClick={() => setOpen(false)}>
              <Icon name="settings" className="ms-sm" /> settings
            </a>
          </div>
          <div className="info-row info-actions">
            <span className="microlabel">Theme</span>
            <ThemeToggle />
          </div>
          <div className="info-row info-actions">
            <span className="microlabel">Version</span>
            <span className="info-v mono">{version ? `kraftwerk ${version}` : "…"}</span>
            <UpdateCheck />
          </div>
        </div>
      )}
    </span>
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

/** Manual "check for updates": asks the server to query the npm registry. */
function UpdateCheck() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  const [info, setInfo] = useState<{ name: string; current: string; latest: string } | null>(null);

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

  if (state === "done" && info) {
    const newer = semverLt(info.current, info.latest);
    return newer ? (
      <span className="update-result newer">
        v{info.latest} available — <code>npm i -g {info.name}@latest</code>
      </span>
    ) : (
      <span className="update-result">
        <Icon name="check" className="ms-sm" /> up to date
      </span>
    );
  }
  return (
    <button className="update-btn" disabled={state === "busy"} onClick={() => void check()}>
      {state === "busy" ? (
        "checking…"
      ) : state === "err" ? (
        "npm unreachable — retry"
      ) : (
        <><Icon name="sync" className="ms-sm" /> check for updates</>
      )}
    </button>
  );
}

function ThemeToggle() {
  return (
    <button
      className="theme-btn"
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
    </button>
  );
}
