import { useEffect, useState } from "react";
import type { RunListItem } from "./types";
import { navigate, useHashPath } from "./shared";
import { RunsScreen } from "./runs";
import { WorkflowIndex } from "./workflows";
import { WorkflowView } from "./workflow-view";
import { ChatScreen } from "./chat";

/**
 * Shell + hash router. Routes: #/ (redirect to latest run), #/runs/<id>,
 * #/workflows, #/workflows/<slug>.
 */
export function App() {
  const path = useHashPath();
  const seg = path.split("/").filter(Boolean);

  let screen: React.ReactNode;
  if (seg[0] === "runs" && seg[1]) screen = <RunsScreen id={seg[1]} />;
  else if (seg[0] === "workflows" && seg[1]) screen = <WorkflowView slug={decodeURIComponent(seg[1])} />;
  else if (seg[0] === "workflows") screen = <WorkflowIndex />;
  else if (seg[0] === "chats") screen = <ChatScreen id={seg[1]} />;
  else screen = <Home />;

  return (
    <>
      <header className="topbar">
        <a href="#/" className="wordmark">
          <span className="lamp-block">
            <span />
          </span>
          <b>kraftwerk</b>
          <small>inspector</small>
        </a>
        <nav>
          <a href="#/">runs</a>
          <a href="#/workflows">workflows</a>
          <a href="#/chats">chat</a>
        </nav>
        <span className="spacer" />
        <OutDir />
        <ThemeToggle />
      </header>
      <main className="shell">{screen}</main>
    </>
  );
}

/** The runs screen lives at #/runs/<id>; land on the latest run. */
function Home() {
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

function OutDir() {
  const [dir, setDir] = useState("");
  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d: { outputDir: string }) => setDir(d.outputDir))
      .catch(() => {});
  }, []);
  return <span className="outdir" title={dir}>{dir}</span>;
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
