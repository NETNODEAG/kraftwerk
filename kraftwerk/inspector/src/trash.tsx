import { useCallback, useEffect, useState } from "react";
import { fmtAgo, Icon, post } from "./shared";
import { Button, EmptyState, ListRow, Notice, Page, PageHeader, Panel } from "./ui";

/**
 * Trash (#/trash): what was deleted anywhere in the inspector or the CLI
 * waits here until it is deleted for good. The list mirrors the trash
 * folder — one panel per kind (agents/, knowledge/, projects/, …) — and
 * every entry can be put back where it came from.
 */

interface TrashEntry {
  id: string;
  kind: string;
  name: string;
  from: string;
  trashedAt: string;
}

const KINDS: Record<string, { label: string; icon: string }> = {
  agents: { label: "agents", icon: "smart_toy" },
  "agent-skills": { label: "agent skills", icon: "extension" },
  projects: { label: "projects", icon: "folder" },
  knowledge: { label: "knowledge bundles", icon: "menu_book" },
  vibeables: { label: "apps", icon: "web" },
  channels: { label: "channels", icon: "forum" },
  repos: { label: "repositories", icon: "source" },
  chats: { label: "chats", icon: "chat" },
  runs: { label: "runs", icon: "play_circle" },
};

export function TrashScreen() {
  const [data, setData] = useState<{ root: string; entries: TrashEntry[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // entry id, or "*" while emptying
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch("/api/trash", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setData(await r.json());
    else setError(r?.status === 404 ? "this server has no trash yet — restart it after updating" : "could not load the trash");
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (verb: "restore" | "purge" | "empty", id: string) => {
    setBusy(id);
    setError("");
    setConfirm(null);
    try {
      const d =
        verb === "empty"
          ? await fetch("/api/trash", { method: "DELETE" }).then((r) => r.json())
          : await post(`/api/trash/${verb}`, { id });
      if (d.error) throw new Error(d.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const entries = data?.entries ?? [];
  const kinds = [...new Set(entries.map((e) => e.kind))].sort(
    (a, b) => Object.keys(KINDS).indexOf(a) - Object.keys(KINDS).indexOf(b)
  );

  return (
    <Page className="px-6 py-6">
      <PageHeader
        icon={<Icon name="delete" className="text-[28px] text-fg-2" />}
        title="Trash"
        sub={data ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : undefined}
        actions={
          entries.length > 0 &&
          (confirm !== "*" ? (
            <Button variant="danger" icon="delete_forever" disabled={!!busy} onClick={() => setConfirm("*")}>
              empty trash
            </Button>
          ) : (
            <>
              <Button variant="danger" icon="delete_forever" onClick={() => void act("empty", "*")}>
                delete all {entries.length} for good
              </Button>
              <Button variant="quiet" onClick={() => setConfirm(null)}>cancel</Button>
            </>
          ))
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}

      {!data && !error && <Panel><EmptyState>loading…</EmptyState></Panel>}
      {data && entries.length === 0 && (
        <Panel><EmptyState icon="delete">The trash is empty. What you delete lands here first.</EmptyState></Panel>
      )}

      {kinds.map((kind) => (
        <Panel key={kind} title={KINDS[kind]?.label ?? kind} actions={<code className="text-xs text-fg-2">trash/{kind}/</code>}>
          <div className="p-1.5">
            {entries.filter((e) => e.kind === kind).map((e) => (
              <ListRow
                key={e.id}
                className="trash-row"
                leading={<Icon name={KINDS[kind]?.icon ?? "draft"} className="ms-sm" />}
                title={e.name}
                sub={<><span className="font-mono">{e.from}</span> · <span title={e.trashedAt}>deleted {fmtAgo(e.trashedAt)}</span></>}
                meta={
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon="restore_from_trash" busy={busy === e.id} disabled={!!busy} onClick={() => void act("restore", e.id)} title={`Put it back at ${e.from}`}>
                      restore
                    </Button>
                    {confirm !== e.id ? (
                      <Button size="sm" variant="danger" icon="delete_forever" disabled={!!busy} onClick={() => setConfirm(e.id)}>
                        delete
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="danger" icon="delete_forever" onClick={() => void act("purge", e.id)}>
                          delete for good
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>cancel</Button>
                      </>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </Panel>
      ))}

      {data && (
        <p className="m-0 text-sm text-fg-2">
          The trash lives in <code>{data.root}</code>, kept out of the workspace git. From the terminal:{" "}
          <code>kraftwerk trash</code>, <code>kraftwerk trash restore &lt;id&gt;</code>, <code>kraftwerk trash empty</code>.
        </p>
      )}
    </Page>
  );
}
