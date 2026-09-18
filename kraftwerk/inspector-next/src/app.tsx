import { useEffect, useState } from "react";
import { getMeta, type Meta } from "./api";
import { Chat } from "./chat";
import { usePendingRuns, useRuns } from "./runs";
import { Switcher } from "./switcher";
import { Workflows } from "./workflows";

/** The whole UI: the workspace switcher on top, a chat and the workflows side by side. */
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
        <Switcher meta={meta} />
      </header>
      <Workspace workspaceKey={meta.projectRoot} />
    </>
  );
}

/**
 * The two panels share the runs: one started on the right is followed in the
 * chat on the left, and its result is handed to the chat once it ends.
 */
function Workspace({ workspaceKey }: { workspaceKey: string }) {
  const { runs, outputDir, refresh } = useRuns();
  const [pending, setPending] = usePendingRuns(workspaceKey);
  // Editing a workflow is a conversation: the edit button drafts its opening line.
  const [compose, setCompose] = useState<{ text: string; n: number } | null>(null);
  // The folder relative to the workspace reads better in the composer and is where the chat's agent works.
  const relative = (abs: string) => (abs.startsWith(`${workspaceKey}/`) ? abs.slice(workspaceKey.length + 1) : abs);

  return (
    <main className="columns">
      <Chat
        workspaceKey={workspaceKey}
        runs={runs}
        outputDir={outputDir}
        pending={pending}
        compose={compose}
        onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
      />
      <Workflows
        runs={runs ?? []}
        onEdit={(name, folder) =>
          setCompose((prev) => ({ text: `Change the workflow "${name}" (${relative(folder)}): `, n: (prev?.n ?? 0) + 1 }))
        }
        onLaunched={(run) => {
          setPending((prev) => [...prev, run]);
          refresh();
        }}
      />
    </main>
  );
}
