import { useState } from "react";
import { useApi } from "./api";
import { fmtWhen, Icon, Link } from "./shared";
import { NEW_ROUTINE, WORKSPACE_ROUTINES, routineWhen, routineWho, runHref, type ListedRoutine } from "./routines";
import { Button, EmptyState, Page, PageHeader, Panel, Tag, TextField } from "./ui";

/** Where a routine opens: on Home, in the column beside the stream. */
const openHref = (owner: string, id: string) => `/?kind=routines&open=${encodeURIComponent(`routines:${owner}:${id}`)}`;

/**
 * Every routine of the workspace on one page (#/settings/routines): the
 * workspace's own and each agent's, with who gets the prompt, where it
 * runs, when it fires next and how the last run went — the admin's view.
 * A routine itself opens (and is edited) on Home.
 */
export function RoutinesAdmin() {
  const data = useApi("routines.list", {}, { interval: 30_000 });
  const projects = useApi("projects.list", {}, { interval: 60_000 });
  const [q, setQ] = useState("");

  const all = data?.routines ?? [];
  const title = (slug: string) => projects?.projects.find((p) => p.slug === slug)?.title ?? slug;
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((r) => !needle || [r.name, r.prompt, r.schedule, r.agent?.name, r.project, r.runsOn].some((v) => v?.toLowerCase().includes(needle)))
    // What fires soonest first; paused and runner-less ones after, by name.
    .sort((a, b) => (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9") || a.name.localeCompare(b.name));
  const firing = all.filter((r) => r.enabled && r.nextRunAt).length;

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="schedule" className="text-[28px] text-fg-2" />}
        title="Routines"
        sub={data ? `${all.length} routine${all.length === 1 ? "" : "s"} · ${firing} scheduled on this machine` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter routines" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href={openHref(WORKSPACE_ROUTINES, NEW_ROUTINE)}>new routine</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="schedule">No routines yet. Create the first one with "new routine".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No routine matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="routines-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>routine</th>
                  <th>who</th>
                  <th>project</th>
                  <th>schedule</th>
                  <th>runs on</th>
                  <th>last run</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Row key={`${r.owner}:${r.id}`} r={r} projectTitle={r.project ? title(r.project) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ r, projectTitle }: { r: ListedRoutine; projectTitle?: string }) {
  return (
    <tr className={`border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3 ${r.enabled ? "" : "opacity-60"}`} data-routine={`${r.owner}:${r.id}`}>
      <td className="max-w-[340px]">
        <Link href={openHref(r.owner, r.id)} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="flex items-center gap-2 font-medium">
            {r.name} {!r.enabled && <Tag>paused</Tag>} {r.private && <Tag>private</Tag>}
          </span>
          <span className="line-clamp-2 text-xs text-fg-2">{r.prompt}</span>
        </Link>
      </td>
      <td className="whitespace-nowrap">
        {routineWho(r)}
        {r.owner !== WORKSPACE_ROUTINES && <div className="text-xs text-fg-2">the agent's own</div>}
      </td>
      <td className="whitespace-nowrap text-fg-2">
        {r.project ? <Link href={`/projects/${encodeURIComponent(r.project)}`}>{projectTitle}</Link> : "—"}
      </td>
      <td className="whitespace-nowrap">
        <code className="text-xs">{r.schedule}</code>
        <div className="text-xs text-fg-2">{routineWhen(r)}</div>
      </td>
      <td className="whitespace-nowrap text-xs">
        {r.runner === "here" ? (
          <Tag title={`runs_on: ${r.runsOn} — this machine fires it`}>here</Tag>
        ) : r.runner === "unassigned" ? (
          <Tag tone={r.enabled ? "ask" : "neutral"} title="no runs_on — it fires on no machine until one adopts it">no runner</Tag>
        ) : (
          <Tag tone={r.retired ? "ask" : "neutral"} title={r.retired ? "a retired identity of this machine — it fires nowhere until reassigned" : "another machine fires it, not this one"}>{r.runsOn}</Tag>
        )}
      </td>
      <td className="whitespace-nowrap text-xs text-fg-2">
        {r.lastChatId ? <Link href={runHref(r, r.lastChatId)}>{fmtWhen(r.lastRunAt)}</Link> : "never ran"}
        {r.awaitingApproval && r.lastChatId && <div><Tag href={runHref(r, r.lastChatId)} tone="bad">needs approval</Tag></div>}
        {r.lastError && <div title={r.lastError}><Tag tone="bad">error</Tag></div>}
      </td>
    </tr>
  );
}
