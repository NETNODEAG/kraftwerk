import { useState } from "react";
import { api, failure, useApi } from "./api";
import { fmtAgo, Icon, Link } from "./shared";
import type { ProjectsView } from "./types";
import { Button, Checkbox, EmptyState, Notice, Page, PageHeader, Panel, Select, Tag, TextField } from "./ui";

type Project = ProjectsView["projects"][number];
type Status = Project["status"];

const STATUSES: Status[] = ["active", "paused", "done", "archived"];
const MARK: Record<Status, string> = { active: "📁", paused: "⏸️", done: "✅", archived: "🗄️" };

/**
 * Every project of the workspace on one page (#/settings/projects): its
 * goal, status, team and last change — the admin's view. The status is set
 * here; an archived project leaves the rail (it stays on disk, in search
 * and here, and comes back by setting it active again).
 */
export function ProjectsAdmin() {
  const [refresh, setRefresh] = useState(0);
  const data = useApi("projects.list", {}, { interval: 30_000, refresh });
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const all = data?.projects ?? [];
  const needle = q.trim().toLowerCase();
  const archived = all.filter((p) => p.status === "archived").length;
  const shown = all
    .filter((p) => showArchived || p.status !== "archived")
    .filter((p) => !needle || [p.title, p.slug, p.goal].some((v) => v?.toLowerCase().includes(needle)))
    // Live work first, the archive last; by title within.
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.title.localeCompare(b.title));
  const agentName = (slug: string) => {
    const a = agents?.agents.find((x) => x.slug === slug);
    return a ? `${a.emoji || "🤖"} ${a.name}` : slug;
  };

  const setStatus = async (p: Project, status: Status) => {
    setBusy(p.slug);
    setError("");
    try {
      const r = await api.request("projects.save", { slug: p.slug, body: { status } });
      if (!r.ok) throw new Error(failure(r));
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(`${p.title}: ${(err as Error).message}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="folder_special" className="text-[28px] text-fg-2" />}
        title="Projects"
        sub={data ? `${all.length} project${all.length === 1 ? "" : "s"}${archived ? ` · ${archived} archived` : ""}` : undefined}
        actions={
          <>
            {archived > 0 && (
              <Checkbox checked={showArchived} onChange={setShowArchived}>
                show archived
              </Checkbox>
            )}
            {all.length > 0 && <TextField aria-label="filter projects" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/projects/new">new project</Button>
          </>
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="folder_special">No projects yet. Create the first one with "new project".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>{needle ? `No project matches "${q}".` : "Every project is archived."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="projects-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>project</th>
                  <th>status</th>
                  <th>agents</th>
                  <th>changed</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.slug} className={`border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3 ${p.status === "archived" ? "opacity-60" : ""}`} data-project={p.slug}>
                    <td className="max-w-[380px]">
                      <Link href={`/projects/${encodeURIComponent(p.slug)}`} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
                        <span className="flex items-center gap-2 font-medium">
                          <span aria-hidden>{MARK[p.status]}</span> {p.title} {p.configError && <Tag tone="bad" title={p.configError}>error</Tag>}
                        </span>
                        <span className="line-clamp-2 text-xs text-fg-2">{p.goal || "no goal written yet"}</span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Select aria-label={`status of ${p.title}`} value={p.status} disabled={busy === p.slug} onChange={(e) => void setStatus(p, e.target.value as Status)} className="h-8 w-[120px] text-sm">
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="text-xs text-fg-2">
                      {(p.agents ?? []).length === 0 ? "—" : (p.agents ?? []).map((slug) => <div key={slug}>{agentName(slug)}</div>)}
                    </td>
                    <td className="whitespace-nowrap text-xs text-fg-2" title={p.updatedAt}>{p.updatedAt ? fmtAgo(p.updatedAt) : "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="quiet" icon={p.status === "archived" ? "unarchive" : "archive"} busy={busy === p.slug} disabled={!!busy} onClick={() => void setStatus(p, p.status === "archived" ? "active" : "archived")} title={p.status === "archived" ? "back to active: it shows in the rail again" : "archive: it leaves the rail, its folder stays"}>
                        {p.status === "archived" ? "unarchive" : "archive"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
