import { useState } from "react";
import { useApi, type ApiResult } from "./api";
import { fmtAgo, Icon, Link } from "./shared";
import { Button, EmptyState, Page, PageHeader, Panel, Tag, TextField } from "./ui";

type Board = ApiResult<"boards.list">["boards"][number];
type Task = ApiResult<"tasks.list">["tasks"][number];

const enc = encodeURIComponent;
const keyOf = (at: { project?: string; board: string }) => `${at.project ?? ""}:${at.board}`;

/**
 * Every board of the workspace on one page (#/settings/boards): the
 * workspace's own and each project's, with how many tasks it holds, how
 * many are still open or wait for review, and when it last changed — the
 * admin's view. A row opens the board.
 */
export function BoardsAdmin() {
  const data = useApi("boards.list", { query: { all: "1" } }, { interval: 30_000 });
  const tasks = useApi("tasks.list", {}, { interval: 30_000 });
  const projects = useApi("projects.list", {}, { interval: 60_000 });
  const [q, setQ] = useState("");

  const all = data?.boards ?? [];
  const title = (slug: string) => projects?.projects.find((p) => p.slug === slug)?.title ?? slug;
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((b) => !needle || [b.title, b.board, b.project, b.project && title(b.project)].some((v) => v?.toLowerCase().includes(needle)))
    // The workspace's own first, then each project's, by title.
    .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.title.localeCompare(b.title));
  const total = all.reduce((n, b) => n + b.tasks, 0);
  const byBoard = new Map<string, Task[]>();
  for (const t of tasks?.tasks ?? []) byBoard.set(keyOf(t), [...(byBoard.get(keyOf(t)) ?? []), t]);

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="view_kanban" className="text-[28px] text-fg-2" />}
        title="Boards"
        sub={data ? `${all.length} board${all.length === 1 ? "" : "s"} · ${total} task${total === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter boards" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/boards/new">new board</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="view_kanban">No boards yet. Create the first one with "new board".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No board matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="boards-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>board</th>
                  <th>project</th>
                  <th>tasks</th>
                  <th>open</th>
                  <th>changed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <Row key={keyOf(b)} b={b} tasks={tasks ? (byBoard.get(keyOf(b)) ?? []) : undefined} projectTitle={b.project ? title(b.project) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ b, tasks, projectTitle }: { b: Board; tasks?: Task[]; projectTitle?: string }) {
  const href = b.project ? `/projects/${enc(b.project)}/boards/${enc(b.board)}` : `/boards/${enc(b.board)}`;
  const done = new Set(b.columns.filter((c) => c.done).map((c) => c.slug));
  const review = new Set(b.columns.filter((c) => c.review).map((c) => c.slug));
  const open = tasks?.filter((t) => !done.has(t.status));
  const inReview = tasks?.filter((t) => review.has(t.status)).length ?? 0;
  const stale = tasks?.filter((t) => t.stale).length ?? 0;
  return (
    <tr className="border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3" data-board={keyOf(b)}>
      <td className="max-w-[340px]">
        <Link href={href} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="flex items-center gap-2 font-medium">
            {b.title} {b.configError && <Tag tone="bad" title={b.configError}>error</Tag>}
          </span>
          <span className="line-clamp-2 text-xs text-fg-2">{b.columns.map((c) => c.label).join(" · ") || b.board}</span>
        </Link>
      </td>
      <td className="whitespace-nowrap text-fg-2">
        {b.project ? <Link href={`/projects/${enc(b.project)}`}>{projectTitle}</Link> : "—"}
      </td>
      <td className="whitespace-nowrap text-fg-2 tabular-nums">{tasks ? tasks.length : b.tasks}</td>
      <td className="whitespace-nowrap text-xs text-fg-2">
        {!open ? (
          ""
        ) : open.length === 0 ? (
          "—"
        ) : (
          <>
            {open.length} open
            {inReview > 0 && <div><Tag tone="ask" title="tasks in a review column: they wait for a human">{inReview} in review</Tag></div>}
            {stale > 0 && <div title="assigned, in a work column, and nothing logged for a while">{stale} stale</div>}
          </>
        )}
      </td>
      <td className="whitespace-nowrap text-xs text-fg-2" title={b.updatedAt}>{fmtAgo(b.updatedAt)}</td>
    </tr>
  );
}
