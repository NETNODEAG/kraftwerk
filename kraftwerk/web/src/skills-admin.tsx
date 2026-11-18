import { useState } from "react";
import { useApi, type ApiResult } from "./api";
import { fmtAgo, Icon, Link } from "./shared";
import { Button, EmptyState, Page, PageHeader, Panel, Tag, TextField } from "./ui";

type Skill = ApiResult<"skills.list">["skills"][number];
type Agent = ApiResult<"agents.list">["agents"][number];

/** Where a skill was found, in words. */
const SOURCES: Record<Skill["source"], { label: string; title: string }> = {
  workspace: { label: "workspace", title: "the workspace's skills root" },
  project: { label: "project", title: ".claude/skills of the workspace" },
  user: { label: "personal", title: "~/.claude/skills on this machine" },
  agent: { label: "agent", title: "an agent's own skills folder" },
};
const ORDER: Skill["source"][] = ["workspace", "project", "agent", "user"];

/**
 * Every skill the workspace finds on one page (#/settings/skills): what it
 * is for, where it comes from and which agents are limited to it — the
 * admin's view. A row opens the skill.
 */
export function SkillsAdmin() {
  const data = useApi("skills.list", {}, { interval: 30_000 });
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const [q, setQ] = useState("");

  const all = data?.skills ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((s) => !needle || [s.name, s.description, SOURCES[s.source].label, s.agent].some((v) => v?.toLowerCase().includes(needle)))
    // The workspace's own first, the personal ones last, by name.
    .sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source) || a.name.localeCompare(b.name));
  const own = all.filter((s) => s.source !== "user").length;
  const agentName = (slug?: string) => agents?.agents.find((a) => a.slug === slug)?.name ?? slug;
  // Agents with a skill allowlist that names it; agents without one may use every skill.
  const limitedTo = (s: Skill): Agent[] => (agents?.agents ?? []).filter((a) => !a.archived && a.skills?.includes(s.name));

  return (
    <Page className="max-w-[1160px] px-6 py-6">
      <PageHeader
        icon={<Icon name="extension" className="text-[28px] text-fg-2" />}
        title="Skills"
        sub={data ? `${own} in the workspace${all.length > own ? ` · ${all.length - own} personal` : ""}` : undefined}
        actions={
          <>
            {all.length > 0 && <TextField aria-label="filter skills" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} className="w-[200px]" />}
            <Button variant="primary" icon="add" href="/agents/chats" title="ask Ralv to make a skill">new skill</Button>
          </>
        }
      />
      <Panel>
        {!data ? (
          <EmptyState>loading…</EmptyState>
        ) : all.length === 0 ? (
          <EmptyState icon="extension">No skills yet. Ask Ralv to make the first one with "new skill".</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>No skill matches "{q}".</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="skills-admin w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-[0.5px] text-fg-2 uppercase [&>th]:px-[18px] [&>th]:py-2.5 [&>th]:font-medium">
                  <th>skill</th>
                  <th>source</th>
                  <th>limited to</th>
                  <th>changed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Row key={`${s.source}:${s.agent ?? ""}:${s.name}`} s={s} owner={agentName(s.agent)} limitedTo={agents ? limitedTo(s) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}

function Row({ s, owner, limitedTo }: { s: Skill; owner?: string; limitedTo?: Agent[] }) {
  const src = SOURCES[s.source];
  return (
    <tr className="border-t border-line align-top [&>td]:px-[18px] [&>td]:py-3" data-skill={s.name}>
      <td className="max-w-[420px]">
        <Link href={`/skills/${encodeURIComponent(s.name)}`} className="flex min-w-0 flex-col gap-0.5 text-fg no-underline hover:text-accent">
          <span className="font-medium">/{s.name}</span>
          {s.description && <span className="line-clamp-2 text-xs text-fg-2">{s.description}</span>}
        </Link>
      </td>
      <td className="whitespace-nowrap text-xs">
        <Tag title={`${src.title} — ${s.dir}`}>{src.label}</Tag>
        {s.source === "agent" && owner && <div className="mt-0.5 text-fg-2">{owner}</div>}
      </td>
      <td className="text-xs text-fg-2" title="agents whose skill allowlist names it; agents without an allowlist may use every skill">
        {!limitedTo
          ? ""
          : limitedTo.length === 0
            ? "—"
            : limitedTo.map((a) => (
                <div key={a.slug}>
                  <Link href={`/agents/${encodeURIComponent(a.slug)}`}>{a.emoji || "🤖"} {a.name}</Link>
                </div>
              ))}
      </td>
      <td className="whitespace-nowrap text-xs text-fg-2" title={s.updatedAt}>{fmtAgo(s.updatedAt)}</td>
    </tr>
  );
}
