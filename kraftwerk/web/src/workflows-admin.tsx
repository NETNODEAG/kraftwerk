import { useState } from "react";
import { useApi, type ApiResult } from "./api";
import { fmtWhen, Icon, Link } from "./shared";
import { Button, Dot, EmptyState, Page, PageHeader, Panel, Tag, TextField } from "./ui";

type Workflow = ApiResult<"workflows.list">["workflows"][number];
type Run = ApiResult<"runs.list">["runs"][number];

/**
 * Every workflow of the workspace on one page (#/settings/workflows): how
 * big it is, whether it takes a request, how often it ran and how the last
 * run went — the admin's view. A row opens the workflow's own page.
 */
export function WorkflowsAdmin() {
  const data = useApi("workflows.list", {}, { interval: 30_000 });
  const runs = useApi("runs.list", {}, { interval: 30_000 });
  const [q, setQ] = useState("");

  const all = data?.workflows ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((w) => !needle || [w.name, w.slug, w.description].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
  const broken = all.filter((w) => w.error).length;
  // A run names its workflow by slug, older ones by name; newest first.
  const runsOf = (w: Workflow): Run[] =>
    (runs?.runs ?? []).filter((r) => r.workflow === w.slug || (!!w.name && r.workflow === w.name)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="account_tree" className="text-[28px] text-fg-2" />}
        title="Workflows"
        sub={data ? `${all.length} workflow${all.length === 1 ? "" : "s"}${broken ? ` · ${broken} unreadable` : ""}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter workflows" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/agents/chats" title="ask Ralv to make a workflow">new workflow</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="account_tree">No workflows yet. Ask Ralv to make the first one with "new workflow".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No workflow matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="workflows-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>workflow</th>
                  <th>steps</th>
                  <th>request</th>
                  <th>runs</th>
                  <th>last run</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((w) => (
                  <Row key={w.slug} w={w} runs={runs ? runsOf(w) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ w, runs }: { w: Workflow; runs?: Run[] }) {
  const last = runs?.[0];
  const waiting = !!last?.awaitingDecision && last.status === "running";
  return (
    <tr className="border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3" data-workflow={w.slug}>
      <td className="max-w-[340px]">
        <Link href={`/workflows/${encodeURIComponent(w.slug)}`} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="flex items-center gap-2 font-medium">
            {w.name || w.slug} {w.error && <Tag tone="bad" title={w.error}>error</Tag>}
          </span>
          <span className="line-clamp-2 text-xs text-fg-2">{w.description || w.slug}</span>
        </Link>
      </td>
      <td className="whitespace-nowrap">
        {w.steps} step{w.steps === 1 ? "" : "s"}
        <div className="text-xs text-fg-2">{w.agents} agent{w.agents === 1 ? "" : "s"}</div>
      </td>
      <td className="whitespace-nowrap text-fg-2" title={w.usesRequest ? "a step reads the request: it asks for one before it runs" : "no step reads a request: it runs straight away"}>
        {w.usesRequest ? "yes" : "no"}
      </td>
      <td className="whitespace-nowrap text-fg-2 tabular-nums">{runs ? runs.length || "—" : ""}</td>
      <td className="whitespace-nowrap text-xs text-fg-2">
        {!runs ? (
          ""
        ) : !last ? (
          "never ran"
        ) : (
          <Link href={`/runs/${encodeURIComponent(last.id)}`} className="inline-flex items-center gap-1.5">
            <Dot tone={waiting ? "ask" : last.status === "running" ? "working" : last.status === "ok" ? "ok" : last.status === "failed" ? "bad" : "idle"} />
            {waiting ? "decision needed" : last.status === "aborted" ? "stopped" : last.status} · {fmtWhen(last.updatedAt)}
          </Link>
        )}
      </td>
    </tr>
  );
}
