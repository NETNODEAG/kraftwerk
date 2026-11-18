import { useState } from "react";
import type { Agent } from "../types";
import { useApi } from "../api";
import { fmtAgo, Icon, Link } from "../shared";
import { Button, Dot, EmptyState, IconButton, Page, PageHeader, Panel, Tag, TextField } from "../ui";

/**
 * Every agent of the workspace on one page (#/settings/agents): who they
 * are, what they run on, what they are linked to and what they are doing —
 * the admin's view, next to the rail's list that is for talking to them.
 * Archived agents are listed too, set back.
 */
export function AgentsAdmin() {
  const data = useApi("agents.list", {}, { interval: 30_000 });
  const status = useApi("agents.status", {}, { interval: 15_000 });
  const [q, setQ] = useState("");

  const all = data?.agents ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((a) => !needle || [a.name, a.slug, a.description, a.group, a.harness, a.model].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
  const active = all.filter((a) => !a.archived).length;

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="smart_toy" className="text-[28px] text-fg-2" />}
        title="Agents"
        sub={data ? `${active} active${all.length > active ? ` · ${all.length - active} archived` : ""}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter agents" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/agents/new">new agent</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="smart_toy">No agents yet. Create the first one with "new agent".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No agent matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="agents-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>agent</th>
                  <th>group</th>
                  <th>runs on</th>
                  <th>linked</th>
                  <th>now</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <Row key={a.slug} a={a} st={status?.[a.slug]} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

interface Status {
  waiting: unknown[];
  working: unknown[];
  nextRoutine?: { id: string; name: string; at: string };
  lastActiveAt?: string;
}

function Row({ a, st }: { a: Agent; st?: Status }) {
  const href = `/agents/${encodeURIComponent(a.slug)}`;
  const linked = [
    [a.workflows.length, "workflow"],
    [a.knowledge.length, "knowledge"],
    [a.vibeables.length, "app"],
    [a.files?.length ?? 0, "folder"],
  ].filter(([n]) => n) as [number, string][];
  return (
    <tr className={`border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3 ${a.archived ? "opacity-60" : ""}`} data-agent={a.slug}>
      <td className="max-w-[340px]">
        <Link href={href} className="flex items-start gap-2.5 text-fg no-underline hover:text-accent">
          <span className="text-[18px] leading-5">{a.emoji || "🤖"}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              {a.name} {a.archived && <Tag>archived</Tag>}
            </span>
            {a.description && <span className="line-clamp-2 text-xs text-fg-2">{a.description}</span>}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap text-fg-2">{a.group ?? "—"}</td>
      <td className="whitespace-nowrap">
        {a.harness}
        {(a.model || a.effort) && <div className="text-xs text-fg-2">{[a.model, a.effort].filter(Boolean).join(" · ")}</div>}
      </td>
      <td className="text-xs text-fg-2">
        {linked.length === 0 && a.skills === undefined ? "—" : linked.map(([n, what]) => <div key={what}>{n} {what}{n === 1 || what === "knowledge" ? "" : "s"}</div>)}
        {a.skills !== undefined && <div title="its skill allowlist; agents without one may use every skill">{a.skills.length === 0 ? "no skills" : `${a.skills.length} skill${a.skills.length === 1 ? "" : "s"} allowed`}</div>}
      </td>
      <td className="whitespace-nowrap text-xs text-fg-2">
        {st?.waiting.length ? (
          <span className="inline-flex items-center gap-1.5 text-fg"><Dot tone="ask" /> waiting for you</span>
        ) : st?.working.length ? (
          <span className="inline-flex items-center gap-1.5 text-fg"><Dot tone="working" /> working</span>
        ) : st?.lastActiveAt ? (
          <>active {fmtAgo(st.lastActiveAt)}</>
        ) : (
          "never used"
        )}
        {st?.nextRoutine && <div title={st.nextRoutine.at}>⏰ {st.nextRoutine.name}</div>}
      </td>
      <td className="whitespace-nowrap text-right">
        <IconButton icon="edit" label={`edit ${a.name}`} size="sm" href={`${href}/edit`} />
      </td>
    </tr>
  );
}
