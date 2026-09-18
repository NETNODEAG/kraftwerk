import { useEffect, useState } from "react";
import { getMeta, type Meta } from "./api";
import { Chat } from "./chat";
import { ChatIcon, KnowledgeIcon, WorkflowIcon } from "./icons";
import { Knowledge } from "./knowledge";
import { RunModal } from "./run-modal";
import { usePendingRuns, useRuns } from "./runs";
import { Side } from "./side";
import { Switcher } from "./switcher";
import { Workflows } from "./workflows";

/** The whole UI: the workspace switcher on top, a chat and what the workspace has side by side. */
export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getMeta()
      .then((m) => {
        setMeta(m);
        document.title = m.projectName ? `${m.projectName} · kraftwerk` : "kraftwerk";
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <main className="fatal" role="alert">
        <h1>No workspace to talk to</h1>
        <p>{error}</p>
        <p>
          Start one with <code>kraftwerk ui</code> and reload.
        </p>
        {/* Dev: the switcher's cookie may point at an instance that stopped since. */}
        {import.meta.env.DEV && document.cookie.includes("kw-target=") && (
          <button
            className="quiet"
            onClick={() => {
              document.cookie = "kw-target=; path=/; max-age=0";
              window.location.reload();
            }}
          >
            Back to the default workspace
          </button>
        )}
      </main>
    );
  }
  if (!meta) return null;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M13.5 2 5 13.5h5.5L9.5 22 19 10h-5.8L13.5 2Z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-name">Kraftwerk</span>
          <span className="brand-tagline">Agentic Workspace</span>
        </div>
        <Switcher meta={meta} />
      </header>
      <Workspace workspaceKey={meta.projectRoot} />
    </>
  );
}

const SIDE_TAB_KEY = "kw-next-side-tab";

/**
 * The two columns share the runs: one started on the right is followed in the
 * chat on the left, and its result is handed to the chat once it ends. Edits
 * asked for on the right travel the same way, as a message.
 */
function Workspace({ workspaceKey }: { workspaceKey: string }) {
  const { runs, outputDir, refresh } = useRuns();
  const [pending, setPending] = usePendingRuns(workspaceKey);
  // Workflows and knowledge are files: a modal hands the wanted change to the chat, whose agent makes it.
  const [compose, setCompose] = useState<{ text: string; n: number } | null>(null);
  // What is asked for on the right is answered on the left: a phone, which shows one of them, goes there.
  const say = (text: string) => {
    setCompose((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    setOnChat(true);
  };
  // Side by side on a desktop. A phone shows one panel and a common navigation
  // below: "chat", or the right column on one of its tabs (the same state the
  // desktop's tabs use, so both always agree).
  const [sideTab, setSideTab] = useState(() => {
    try {
      return localStorage.getItem(SIDE_TAB_KEY) === "knowledge" ? "knowledge" : "workflows";
    } catch {
      return "workflows";
    }
  });
  const [onChat, setOnChat] = useState(true);
  // A run's details open from a workflow's runs and from its card in the chat: one modal for the page.
  const [openRun, setOpenRun] = useState<string | null>(null);
  const pickSideTab = (id: string) => {
    setSideTab(id);
    try {
      localStorage.setItem(SIDE_TAB_KEY, id);
    } catch {
      /* the tab is simply not remembered */
    }
  };
  const places = [
    { id: "chat", label: "Chat", icon: <ChatIcon /> },
    { id: "workflows", label: "Workflows", icon: <WorkflowIcon /> },
    { id: "knowledge", label: "Knowledge", icon: <KnowledgeIcon /> },
  ];
  const place = onChat ? "chat" : sideTab;
  // A folder relative to the workspace reads better in a message and is where the chat's agent works.
  const relative = (abs: string) => (abs.startsWith(`${workspaceKey}/`) ? abs.slice(workspaceKey.length + 1) : abs);

  return (
    <>
      <main className="columns" data-place={onChat ? "chat" : "side"}>
        <Chat
          workspaceKey={workspaceKey}
          runs={runs}
          outputDir={outputDir}
          pending={pending}
          compose={compose}
          onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
        onOpenRun={setOpenRun}
        />
        <Side
          active={sideTab}
          onPick={pickSideTab}
          tabs={[
            {
              id: "workflows",
              label: "Workflows",
              content: (
                <Workflows
                  runs={runs ?? []}
                onOpenRun={setOpenRun}
                  onEdit={(name, folder, change) => say(`Change the workflow "${name}" (${relative(folder)}): ${change}`)}
                  onAdd={(spec, root) =>
                  say(
                    `Create a new workflow${root ? ` in ${relative(root)}` : ""}: ${spec}\n\n` +
                      'Get the build brief with `npx kraftwerk create "<the description above>"` and follow it to the end, including `npx kraftwerk validate`.'
                  )
                }
                onLaunched={(run) => {
                    setPending((prev) => [...prev, run]);
                    refresh();
                    setOnChat(true); // the run is followed, and reported, in the chat
                  }}
                />
              ),
            },
            {
              id: "knowledge",
              label: "Knowledge",
              content: (
                <Knowledge
                  onEdit={(bundle, folder, change) =>
                    say(
                      `Change the knowledge "${bundle}" (${relative(folder)}): ${change}\n\n` +
                        "Read and write it with `npx kraftwerk knowledge` (list, get, put --actor), never by editing index.md or log.md."
                    )
                  }
                />
              ),
            },
          ]}
        />
      </main>
      {openRun && (
        <RunModal
          runId={openRun}
          onClose={() => {
            setOpenRun(null);
            refresh(); // a decision given in there changes what the cards say
          }}
        />
      )}
      <nav className="places" aria-label="Sections">
        {places.map((p) => (
          <button
            key={p.id}
            className="place"
            aria-current={p.id === place ? "page" : undefined}
            onClick={() => {
              setOnChat(p.id === "chat");
              if (p.id !== "chat") pickSideTab(p.id);
            }}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </nav>
    </>
  );
}
