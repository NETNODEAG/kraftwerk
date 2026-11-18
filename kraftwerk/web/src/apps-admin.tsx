import { useState } from "react";
import { useApi, type ApiResult } from "./api";
import { fmtAgo, Icon, Link } from "./shared";
import { Button, EmptyState, Page, PageHeader, Panel, Tag, TextField } from "./ui";

type App = ApiResult<"vibeables.list">["vibeables"][number];
type Agent = ApiResult<"agents.list">["agents"][number];

/**
 * Every app (vibeable) of the workspace on one page (#/settings/apps):
 * what its preview shows, which agents work on it and when it last
 * changed — the admin's view. A row opens the app.
 */
export function AppsAdmin() {
  const data = useApi("vibeables.list", {}, { interval: 30_000 });
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const [q, setQ] = useState("");

  const all = data?.vibeables ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((v) => !needle || [v.slug, v.dev].some((x) => x?.toLowerCase().includes(needle))).sort((a, b) => a.slug.localeCompare(b.slug));
  const broken = all.filter((v) => v.configError).length;
  const usedBy = (v: App): Agent[] => (agents?.agents ?? []).filter((a) => !a.archived && a.vibeables.includes(v.slug));

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="web" className="text-[28px] text-fg-2" />}
        title="Apps"
        sub={data ? `${all.length} app${all.length === 1 ? "" : "s"}${broken ? ` · ${broken} unreadable` : ""}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter apps" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/vibeables/new">new app</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="web">{data.error ?? 'No apps yet. Create the first one with "new app".'}</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No app matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="apps-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>app</th>
                  <th>preview</th>
                  <th>used by</th>
                  <th>changed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <Row key={v.slug} v={v} usedBy={agents ? usedBy(v) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ v, usedBy }: { v: App; usedBy?: Agent[] }) {
  return (
    <tr className="border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3" data-app={v.slug}>
      <td className="max-w-[340px]">
        <Link href={`/vibeables/${encodeURIComponent(v.slug)}`} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="flex items-center gap-2 font-medium">
            {v.slug} {v.configError && <Tag tone="bad" title={v.configError}>error</Tag>}
          </span>
          <span className="truncate text-xs text-fg-2" title={v.path}>{v.path}</span>
        </Link>
      </td>
      <td className="whitespace-nowrap">
        {v.dev ? (
          <>
            dev server
            <div className="text-xs text-fg-2"><code>{v.dev}</code></div>
          </>
        ) : v.hasIndex ? (
          "static page"
        ) : (
          <span className="text-fg-2" title="no index.html in the served folder and no dev command">nothing to show yet</span>
        )}
      </td>
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
      <td className="whitespace-nowrap text-xs text-fg-2" title={v.updatedAt}>{fmtAgo(v.updatedAt)}</td>
    </tr>
  );
}
