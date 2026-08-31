import { useEffect, useState } from "react";
import type { RunListItem } from "./types";
import { navigate, setExpertMode, useExpertMode, useHashPath } from "./shared";
import { RunsScreen } from "./runs";
import { WorkflowIndex } from "./workflows";
import { WorkflowView } from "./workflow-view";
import { DashboardScreen } from "./dashboard";
import { KnowledgeScreen } from "./knowledge";
import { SkillsScreen } from "./skills";
import { TeamScreen } from "./team";

/**
 * Shell + hash router. Routes: #/ (dashboard), #/runs (redirect to latest
 * run), #/runs/<id>, #/workflows, #/workflows/<slug>,
 * #/knowledge[/<bundle>[/<concept-path>]], #/skills[/<name>],
 * #/agents[/new | /chats[/<chatId>] | /<slug>[/info | /edit | /chat/<chatId>]].
 * A bare #/agents/<slug> opens the agent's most recent session; the profile
 * lives at /info. Legacy #/team/* and #/chats[/<id>] links still land here.
 */
export function App() {
  const path = useHashPath();
  const seg = path.split("/").filter(Boolean);
  const [projectName, setProjectName] = useState("");
  const [projectIcon, setProjectIcon] = useState("");
  const [switcher, setSwitcher] = useState<SwitcherEntry[]>([]);
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { projectName?: string; projectIcon?: string; switcher?: SwitcherEntry[] }) => {
        setProjectName(d.projectName ?? "");
        setProjectIcon(d.projectIcon ?? "");
        setSwitcher(Array.isArray(d.switcher) ? d.switcher : []);
      })
      .catch(() => {});
  }, []);
  // Browser-tab title + favicon carry the instance identity so multiple
  // open kraftwerks stay distinguishable (kraftwerk.yml: name, icon).
  useEffect(() => {
    document.title = projectName ? `${projectName} — kraftwerk` : "kraftwerk inspector";
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
  else if (seg[0] === "chats") screen = <TeamScreen seg={seg} />;
  else if (seg[0] === "skills") screen = <SkillsScreen name={seg[1] ? decodeURIComponent(seg[1]) : undefined} />;
  else if (seg[0] === "agents" || seg[0] === "team") screen = <TeamScreen seg={seg.slice(1)} />;
  else if (seg[0] === "knowledge") {
    // Concept ids are paths — everything after the bundle segment.
    screen = (
      <KnowledgeScreen
        bundle={seg[1] ? decodeURIComponent(seg[1]) : undefined}
        conceptId={seg.length > 2 ? seg.slice(2).map(decodeURIComponent).join("/") : undefined}
      />
    );
  } else screen = <DashboardScreen />;

  return (
    <>
      <header className="topbar">
        <span className="wordmark">
          <a href="#/" className="wordmark-link">
            <span className="lamp-block">
              <span />
            </span>
            <b>kraftwerk</b>
          </a>
          {projectName && (
            <WorkspaceSwitcher name={projectName} icon={projectIcon} entries={switcher} />
          )}
        </span>
        <nav>
          <a href="#/agents">agents</a>
          <a href="#/knowledge">context &amp; knowledge</a>
          <a href="#/workflows">workflows</a>
          <a href="#/runs">workflow runs</a>
          <a href="#/skills">skills</a>
        </nav>
        <span className="spacer" />
        <ExpertToggle />
        <ProjectInfo />
      </header>
      <main className="shell">{screen}</main>
    </>
  );
}

/** One workspace-switcher entry (kraftwerk.yml: switcher). */
interface SwitcherEntry {
  name: string;
  url: string;
  icon?: string;
}

/**
 * The workspace name in the header. With `switcher:` entries in
 * kraftwerk.yml it becomes a dropdown linking to the other kraftwerk
 * instances; without, it stays a plain label.
 */
function WorkspaceSwitcher({ name, icon, entries }: { name: string; icon: string; entries: SwitcherEntry[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".switcher-wrap")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (entries.length === 0) {
    return <span className="env-name" title="Project (kraftwerk.yml: name)">{name}</span>;
  }
  return (
    <span className="switcher-wrap">
      <button
        className="env-name env-switch"
        title="Switch workspace (kraftwerk.yml: switcher)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {name}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
          <path d="M7 10l5 5 5-5H7Z" />
        </svg>
      </button>
      {open && (
        <div className="switcher-pop" role="menu">
          <span className="switcher-item current" aria-current="true">
            <span className="switcher-icon">{icon || "•"}</span>
            <span className="switcher-name">{name}</span>
            <span className="switcher-hint">current</span>
          </span>
          {entries.map((e) => (
            <a key={e.url} className="switcher-item" role="menuitem" href={e.url}>
              <span className="switcher-icon">{e.icon || "•"}</span>
              <span className="switcher-name">{e.name}</span>
              <code className="switcher-url">{e.url.replace(/^https?:\/\//, "")}</code>
            </a>
          ))}
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
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
          <path d="M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
        </svg>
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
            <span className="microlabel">Theme</span>
            <ThemeToggle />
          </div>
          <div className="info-row info-actions">
            <span className="microlabel">Version</span>
            <span className="info-v mono">{version ? `kraftwerk ${version}` : "…"}</span>
          </div>
        </div>
      )}
    </span>
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
