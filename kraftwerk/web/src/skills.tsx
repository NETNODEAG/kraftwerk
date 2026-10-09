import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SkillDetail, SkillInfo } from "./types";
import { api, useApi } from "./api";
import { navigate } from "./shared";
import { Dot, EmptyState, Fact, Facts, ListRow, Panel, SideHead, SideList, SideNote, Tabs, Tag, Title } from "./ui";

/**
 * Skills: browsable instruction packages. Workspace skills (the kraftwerk
 * skills root, git-tracked and shared with the team) come first; skills
 * from .claude/skills and the personal ~/.claude/skills are listed below
 * as machine-/repo-local extras, clearly separated.
 */

const SOURCE_LABEL: Record<SkillInfo["source"], string> = {
  workspace: "workspace",
  project: ".claude",
  user: "global",
  agent: "agent",
};

function sourceTag(source: SkillInfo["source"]) {
  return <Tag tone={source === "workspace" ? "ok" : source === "agent" ? "accent" : "neutral"}>{SOURCE_LABEL[source]}</Tag>;
}

export function SkillsScreen({ name }: { name?: string }) {
  const data = useApi("skills.list", {});
  const skills = data?.skills ?? [];
  const workspace = skills.filter((s) => s.source === "workspace");
  const local = skills.filter((s) => s.source !== "workspace");
  // A bare #/skills lands on the first workspace skill (else the first local one).
  const first = workspace[0] ?? local[0];
  useEffect(() => {
    if (!name && first) navigate(`/skills/${encodeURIComponent(first.name)}`, { replace: true });
  }, [name, first?.name]);

  const row = (s: SkillInfo) => (
    <ListRow
      key={`${s.source}:${s.name}`}
      href={`/skills/${encodeURIComponent(s.name)}`}
      active={s.name === name}
      size="sm"
      leading={<Dot tone={s.source === "workspace" ? "ok" : "idle"} />}
      title={`/${s.name}`}
      titleExtra={s.source !== "workspace" && sourceTag(s.source)}
      sub={s.description || "no description"}
    />
  );

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead title="workspace skills" />
        <SideList>
          {workspace.map(row)}
          {data && workspace.length === 0 && <SideNote>no workspace skills yet</SideNote>}
          {local.length > 0 && (
            <>
              <SideHead title="local (this machine / repo)" divided />
              {local.map(row)}
            </>
          )}
        </SideList>
      </aside>
      <div className="runs-main">
        {name ? (
          <SkillView key={name} name={name} />
        ) : data && !first ? (
          <SkillsHome root={data.root} />
        ) : (
          <EmptyState>loading…</EmptyState>
        )}
      </div>
    </div>
  );
}

/* ---------- home ---------- */

/** No skills anywhere yet: the one thing to do, and where. */
function SkillsHome({ root }: { root: string }) {
  return (
    // empty-action: the hook the landing test reads.
    <div className="empty-action py-6">
      <EmptyState icon="extension">
        Create <code>{root}/&lt;name&gt;/SKILL.md</code> and it appears here and in every session's <code>/</code> menu.
      </EmptyState>
    </div>
  );
}

/* ---------- detail ---------- */

function SkillView({ name }: { name: string }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [view, setView] = useState<"rendered" | "source">("rendered");
  // Strip the frontmatter for the rendered view; the source tab shows the full file.
  const body = useMemo(
    () => (skill ? skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "") : ""),
    [skill?.content]
  );
  const html = useMemo(
    () => (skill ? DOMPurify.sanitize(marked.parse(body, { async: false })) : ""),
    [body]
  );

  useEffect(() => {
    api.call("skills.get", { name }).then(setSkill, () => setGone(true));
  }, [name]);

  if (gone) return <EmptyState icon="extension">skill not found</EmptyState>;
  if (!skill) return <EmptyState>loading…</EmptyState>;

  return (
    <div className="agent-view flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Title size="lg">/{skill.name}</Title>
        {sourceTag(skill.source)}
      </div>
      {skill.description && <p className="-mt-2 mb-0 mx-0.5 text-sm leading-[1.6] text-fg-2">{skill.description}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4 max-[1020px]:grid-cols-1">
        <Panel
          className="min-w-0"
          title="SKILL.md"
          actions={
            <Tabs
              bare
              label="SKILL.md view"
              value={view}
              onChange={setView}
              items={[
                { id: "rendered", label: "rendered" },
                { id: "source", label: "source" },
              ]}
            />
          }
        >
          {view === "rendered" ? (
            <div
              className="md-body h-auto overflow-visible [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="m-0 max-h-[560px] overflow-auto px-[18px] py-3.5 font-mono text-xs leading-[1.55] break-words whitespace-pre-wrap text-fg-2">
              {skill.content.trim() || "(empty)"}
            </pre>
          )}
        </Panel>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title="about">
            <Facts>
              <Fact label="source">
                {skill.source === "workspace"
                  ? "workspace — git-tracked, shared with the team"
                  : skill.source === "project"
                    ? "repo .claude/skills — tracked, but outside the workspace root"
                    : "global ~/.claude/skills — only on this machine"}
              </Fact>
              <Fact label="path" mono>
                <span title={skill.path}>{skill.path}</span>
              </Fact>
              <Fact label="invoke">
                <span>
                  <code>/{skill.name}</code> in any session
                </span>
              </Fact>
              {skill.files.length > 0 && (
                <Fact label="bundled files" mono>
                  {skill.files.map((f) => (
                    <span key={f} className="block w-full">
                      {f}
                    </span>
                  ))}
                </Fact>
              )}
            </Facts>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
