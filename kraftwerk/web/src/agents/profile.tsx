import { useEffect, useState } from "react";
import type { AgentDetail } from "../types";
import { api, failure, useApi } from "../api";
import { Icon, useFeatures } from "../shared";
import { Avatar, Button, Checkbox, cn, EmptyState, Hint, Notice, Panel, PanelRow, PanelRows, RowIcon, Tag, TextArea, Title } from "../ui";
import { SUB, Chips, Checks, CODE_AREA } from "./shared";
import { AgentSkillsPanel } from "./skills";
import { RoutinesPanel } from "./routines";

/** The agent profile page, with role and connections editable in place. */

/**
 * Agent profile with in-place editing: role, workflows, knowledge, vibeables
 * and skills save right here (full PUT with the changed section merged in).
 * Identity fields (name, emoji, harness, model, …) stay in the full editor.
 */
export function AgentView({ slug }: { slug: string }) {
  const [agent, setMember] = useState<AgentDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editing, setEditing] = useState<"" | "role" | "workflows" | "knowledge" | "vibeables" | "skills">("");
  const [roleDraft, setRoleDraft] = useState("");
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [allSkillsDraft, setAllSkillsDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const features = useFeatures();
  const wfData = useApi("workflows.list", {});
  const kData = useApi("knowledge.list", {});
  const vData = useApi("vibeables.list", features.vibeables ? {} : null);
  const sData = useApi("skills.list", {});

  useEffect(() => {
    let alive = true;
    api
      .call("agents.get", { slug })
      .then((m) => alive && setMember(m))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  async function save(patch: {
    system?: string;
    workflows?: string[];
    knowledge?: string[];
    vibeables?: string[];
    skills?: string[];
  }): Promise<void> {
    if (!agent) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.request("agents.save", {
        slug,
        // Full agent + the changed section; an absent skills key = all skills.
        body: {
          name: agent.name,
          emoji: agent.emoji,
          description: agent.description,
          harness: agent.harness,
          model: agent.model,
          effort: agent.effort,
          group: agent.group,
          system: agent.system,
          workflows: agent.workflows,
          knowledge: agent.knowledge,
          vibeables: agent.vibeables,
          skills: agent.skills,
          ...patch,
        },
      });
      if (!res.ok) setError(failure(res));
      else {
        setMember(res.data);
        setEditing("");
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  function toggleDraft(name: string, on: boolean): void {
    setListDraft(on ? [...listDraft, name] : listDraft.filter((n) => n !== name));
  }

  async function setArchived(archived: boolean): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await api.request("agents.archive", { slug, body: { archived } });
      if (!r.ok) setError(failure(r));
      else setMember(r.data);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  if (gone) return <EmptyState icon="person_off">agent not found</EmptyState>;
  if (!agent) return <EmptyState>loading…</EmptyState>;

  const editActions = (patch: Parameters<typeof save>[0]) => (
    <div className="mt-2 flex items-center gap-2.5">
      <Button variant="primary" busy={saving} onClick={() => void save(patch)}>
        {saving ? "saving…" : "save"}
      </Button>
      <Button variant="quiet" disabled={saving} onClick={() => (setEditing(""), setError(""))}>
        cancel
      </Button>
    </div>
  );
  const editButton = (open: () => void) => (
    <Button
      size="sm"
      onClick={() => {
        open();
        setError("");
      }}
    >
      edit
    </Button>
  );

  return (
    <div className="agent-view flex animate-rise flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Avatar>
          <span aria-hidden>{agent.emoji}</span>
        </Avatar>
        <Title size="lg">{agent.name}</Title>
        <Tag>{agent.harness}</Tag>
        {agent.model && <Tag>{agent.model}</Tag>}
        {agent.effort && <Tag>effort: {agent.effort}</Tag>}
        {agent.archived && (
          <Tag>
            <Icon name="inventory_2" className="ms-sm mr-1" /> archived
          </Tag>
        )}
        <span className="flex-1" />
        <Button href={`/agents/${encodeURIComponent(slug)}/edit`}>edit</Button>
        {agent.archived ? (
          <Button variant="primary" icon="unarchive" busy={saving} onClick={() => void setArchived(false)}>
            {saving ? "…" : "unarchive"}
          </Button>
        ) : (
          <Button
            variant="quiet"
            icon="archive"
            disabled={saving}
            title="Hide this agent from the roster — restorable any time"
            onClick={() => void setArchived(true)}
          >
            archive
          </Button>
        )}
      </div>
      <Panel>
        <PanelRows>
          <div>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-[18px] py-3 text-left font-[inherit] text-inherit hover:bg-surface-2"
              aria-expanded={roleOpen}
              onClick={() => setRoleOpen(!roleOpen)}
            >
              <RowIcon name="badge" />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-[13.5px] font-medium text-fg">role</span>
                {!roleOpen && (
                  <span className={cn(SUB, "truncate")}>
                    {(agent.system || "").trim().split("\n")[0] || "empty — expand to give this agent a role"}
                  </span>
                )}
              </span>
              <Icon name="expand_more" className={cn("ms-sm flex-none text-fg-2 transition-transform", roleOpen && "rotate-180")} />
            </button>
            {roleOpen && editing !== "role" && (
              <div className="pr-[18px] pb-4 pl-16">
                <pre className="m-0 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap">
                  {agent.system || "(empty — click edit to give this agent a role)"}
                </pre>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <Button
                    size="sm"
                    icon="edit"
                    onClick={() => {
                      setRoleDraft(agent.system);
                      setEditing("role");
                      setError("");
                    }}
                  >
                    edit role
                  </Button>
                  <span className="flex-1" />
                  <span className={SUB}>agents/{agent.slug}/system.md</span>
                </div>
              </div>
            )}
            {roleOpen && editing === "role" && (
              <div className="pr-[18px] pb-4 pl-16">
                <TextArea
                  className={CODE_AREA}
                  aria-label="role"
                  rows={Math.min(24, Math.max(8, roleDraft.split("\n").length + 2))}
                  value={roleDraft}
                  placeholder={"You are the ... for this project. Your job is ..."}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  spellCheck={false}
                />
                {editActions({ system: roleDraft })}
              </div>
            )}
          </div>
          <PanelRow
            icon="account_tree"
            title="workflows"
            action={editing !== "workflows" && editButton(() => (setListDraft(agent.workflows), setEditing("workflows")))}
          >
            {editing === "workflows" ? (
              <>
                <Checks>
                  {(wfData?.workflows ?? []).map((w) => (
                    <Checkbox key={w.slug} checked={listDraft.includes(w.slug)} onChange={(on) => toggleDraft(w.slug, on)} hint={w.description} mono>{w.slug}</Checkbox>
                  ))}
                  {(wfData?.workflows ?? []).length === 0 && <Hint className="py-1.5 px-0">no workflows in this project</Hint>}
                </Checks>
                {editActions({ workflows: listDraft })}
              </>
            ) : agent.workflows.length === 0 ? (
              <span className={SUB}>none connected — the agent can run any workflow you connect</span>
            ) : (
              <Chips>
                {agent.workflows.map((w) => (
                  <Tag key={w} href={`/workflows/${encodeURIComponent(w)}`}>
                    {w}
                  </Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
          <PanelRow
            icon="menu_book"
            title="knowledge"
            action={editing !== "knowledge" && editButton(() => (setListDraft(agent.knowledge), setEditing("knowledge")))}
          >
            {editing === "knowledge" ? (
              <>
                <Checks>
                  {(kData?.bundles ?? []).map((b) => (
                    <Checkbox key={b.name} checked={listDraft.includes(b.name)} onChange={(on) => toggleDraft(b.name, on)} hint={`${b.concepts} concepts`} mono>{b.name}</Checkbox>
                  ))}
                  {(kData?.bundles ?? []).length === 0 && <Hint className="py-1.5 px-0">no knowledge bundles in this project</Hint>}
                </Checks>
                {editActions({ knowledge: listDraft })}
              </>
            ) : agent.knowledge.length === 0 ? (
              <span className={SUB}>none connected — connected bundles are read and kept current by the agent</span>
            ) : (
              <Chips>
                {agent.knowledge.map((b) => (
                  <Tag key={b} href={`/knowledge/${encodeURIComponent(b)}`}>
                    {b}
                  </Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
          {(features.vibeables || (agent.vibeables ?? []).length > 0) && (
            <PanelRow
              icon="web"
              title="apps"
              data-link-kind="vibeables"
              action={editing !== "vibeables" && editButton(() => (setListDraft(agent.vibeables ?? []), setEditing("vibeables")))}
            >
              {editing === "vibeables" ? (
                <>
                  <Checks>
                    {(vData?.vibeables ?? []).map((v) => (
                      <Checkbox key={v.slug} checked={listDraft.includes(v.slug)} onChange={(on) => toggleDraft(v.slug, on)} hint={v.dev ? "dev" : "static"} mono>{v.slug}</Checkbox>
                    ))}
                    {/* A linked app that is gone stays in the draft so unticking removes it; it just has no folder to show. */}
                    {listDraft
                      .filter((slug) => !(vData?.vibeables ?? []).some((v) => v.slug === slug))
                      .map((slug) => (
                        <Checkbox key={slug} checked onChange={(on) => toggleDraft(slug, on)} hint="not found in this workspace" mono>{slug}</Checkbox>
                      ))}
                    {!features.vibeables && <Hint className="py-1.5 px-0">vibeables are off in this workspace's settings</Hint>}
                    {features.vibeables && (vData?.vibeables ?? []).length === 0 && (
                      <Hint className="py-1.5 px-0">no apps in this workspace yet — create one on the apps page</Hint>
                    )}
                  </Checks>
                  {editActions({ vibeables: listDraft })}
                </>
              ) : (agent.vibeables ?? []).length === 0 ? (
                <span className={SUB}>none linked — linked apps are the agent's to build and maintain; it knows them from the first message</span>
              ) : (
                <Chips>
                  {(agent.vibeables ?? []).map((v) => {
                    const found = !features.vibeables || !vData || vData.vibeables.some((x) => x.slug === v);
                    return (
                      <Tag
                        key={v}
                        href={`/vibeables/${encodeURIComponent(v)}`}
                        tone={found ? "neutral" : "bad"}
                        title={found ? undefined : "configured but not found in this workspace"}
                      >
                        {v}
                        {!found && " · not found"}
                      </Tag>
                    );
                  })}
                </Chips>
              )}
            </PanelRow>
          )}
          <PanelRow
            icon="extension"
            title="shared skills"
            action={
              editing !== "skills" &&
              editButton(() => {
                setAllSkillsDraft(agent.skills === undefined);
                setListDraft(agent.skills ?? []);
                setEditing("skills");
              })
            }
          >
            {editing === "skills" ? (
              <>
                <Checks>
                  <Checkbox checked={allSkillsDraft} onChange={setAllSkillsDraft} hint="every discovered skill, including future ones" mono>all skills</Checkbox>
                  {!allSkillsDraft &&
                    (sData?.skills ?? []).map((s) => (
                      <Checkbox key={s.name} checked={listDraft.includes(s.name)} onChange={(on) => toggleDraft(s.name, on)} hint={s.description} mono>{`/${s.name}`}</Checkbox>
                    ))}
                  {!allSkillsDraft && (sData?.skills ?? []).length === 0 && (
                    <Hint className="py-1.5 px-0">no skills found (.claude/skills, project or user)</Hint>
                  )}
                </Checks>
                {editActions({ skills: allSkillsDraft ? undefined : listDraft })}
              </>
            ) : agent.skills === undefined ? (
              <span className={SUB}>all discovered skills (default) — invoke with /name in a session</span>
            ) : agent.skills.length === 0 ? (
              <span className={SUB}>none — this agent runs without skills</span>
            ) : (
              <Chips>
                {agent.skills.map((s) => (
                  <Tag key={s}>/{s}</Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
        </PanelRows>
        {error && (
          <div className="px-[18px] pb-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </Panel>

      <AgentSkillsPanel slug={slug} />
      <RoutinesPanel slug={slug} />
    </div>
  );
}
