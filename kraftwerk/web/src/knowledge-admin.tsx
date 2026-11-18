import { useState } from "react";
import { useApi, type ApiResult } from "./api";
import { fmtAgo, Icon, Link } from "./shared";
import { Button, EmptyState, Page, PageHeader, Panel, TextField } from "./ui";

type Bundle = ApiResult<"knowledge.list">["bundles"][number];
type Agent = ApiResult<"agents.list">["agents"][number];

/**
 * Every knowledge bundle of the workspace on one page
 * (#/settings/knowledge): how many pages it holds, when it last changed
 * and which agents work from it — the admin's view. A row opens the bundle.
 */
export function KnowledgeAdmin() {
  const data = useApi("knowledge.list", {}, { interval: 30_000 });
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const [q, setQ] = useState("");

  const all = data?.bundles ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((b) => !needle || b.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
  const pages = all.reduce((n, b) => n + b.concepts, 0);
  const usedBy = (b: Bundle): Agent[] => (agents?.agents ?? []).filter((a) => !a.archived && a.knowledge.includes(b.name));

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="menu_book" className="text-[28px] text-fg-2" />}
        title="Knowledge"
        sub={data ? `${all.length} bundle${all.length === 1 ? "" : "s"} · ${pages} page${pages === 1 ? "" : "s"}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter knowledge" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/knowledge/new">new bundle</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="menu_book">No knowledge yet. Create the first bundle with "new bundle".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No bundle matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="knowledge-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>bundle</th>
                  <th>pages</th>
                  <th>changed</th>
                  <th>used by</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <Row key={b.name} b={b} usedBy={agents ? usedBy(b) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ b, usedBy }: { b: Bundle; usedBy?: Agent[] }) {
  return (
    <tr className="border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3" data-bundle={b.name}>
      <td className="max-w-[340px]">
        <Link href={`/knowledge/${encodeURIComponent(b.name)}`} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="font-medium">{b.name}</span>
          {b.okfVersion && <span className="text-xs text-fg-2">OKF {b.okfVersion}</span>}
        </Link>
      </td>
      <td className="whitespace-nowrap text-fg-2 tabular-nums">{b.concepts}</td>
      <td className="whitespace-nowrap text-xs text-fg-2" title={b.updatedAt}>{fmtAgo(b.updatedAt)}</td>
      <td className="text-xs text-fg-2">
        {!usedBy
          ? ""
          : usedBy.length === 0
            ? "—"
            : usedBy.map((a) => (
                <div key={a.slug}>
                  <Link href={`/agents/${encodeURIComponent(a.slug)}`}>{a.emoji || "🤖"} {a.name}</Link>
                </div>
              ))}
      </td>
    </tr>
  );
}
