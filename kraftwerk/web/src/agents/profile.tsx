import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentDetail } from "../types";
import { api, failure, useApi } from "../api";
import { Icon, useFeatures } from "../shared";
import { Avatar, Button, Checkbox, EmptyState, Hint, Notice, Tag, TextArea, Title } from "../ui";
import { SUB, Chips, Checks, CODE_AREA } from "./shared";
import { AgentSkillsPanel } from "./skills";
import { RoutinesPanel } from "./routines";

/** The agent profile page, with role and connections editable in place. */

type Patch = {
  system?: string;
  workflows?: string[];
  knowledge?: string[];
  vibeables?: string[];
  skills?: string[];
};
type Kind = "workflows" | "knowledge" | "vibeables" | "skills";

/** One kind of linked things: a plain heading, what is linked under it, and "edit" for the checklist. */
function Linked({
  title,
  kind,
  editing,
  saving,
  onToggle,
  children,
}: {
  title: string;
  kind: Kind;
  editing: boolean;
  saving: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1" data-link-kind={kind}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-sm font-semibold text-fg">{title}</h3>
        <span className="flex-1" />
        {editing ? (
          // Busy until the last tick is saved, so "done" always closes on what is stored.
          <Button size="sm" variant="quiet" busy={saving} onClick={onToggle}>
            done
          </Button>
        ) : (
          <Button size="sm" variant="quiet" icon="edit" onClick={onToggle}>
            edit
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Agent profile, edited in place: what the agent is told saves when the
 * field is left, workflows, knowledge, apps and skills on every tick (full
 * PUT with the changed part merged in). Identity fields (name, emoji,
 * harness, model, …) read as facts beside it and stay in the full editor.
 */
export function AgentView({ slug }: { slug: string }) {
  const [agent, setMember] = useState<AgentDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [editing, setEditing] = useState<"" | Kind>("");
  // Edited in place; null = showing the server's text.
  const [role, setRole] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The agent as the page shows it (a tick counts before the server answered), and the saves still on their way.
  const agentRef = useRef<AgentDetail | null>(null);
  const roleRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);

  const features = useFeatures();
  const wfData = useApi("workflows.list", {});
  const kData = useApi("knowledge.list", {});
  const vData = useApi("vibeables.list", features.vibeables ? {} : null);
  const sData = useApi("skills.list", {});

  const show = (a: AgentDetail) => {
    agentRef.current = a;
    setMember(a);
  };
  const editRole = (v: string | null) => {
    roleRef.current = v;
    setRole(v);
  };

  useEffect(() => {
    let alive = true;
    api
      .call("agents.get", { slug })
      .then((m) => alive && show(m))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  /** Shows the change at once and saves it; saves go one after the other, each with the agent as it stands then. */
  function save(patch: Patch, keepalive = false): Promise<boolean> {
    const base = agentRef.current;
    if (!base) return Promise.resolve(false);
    show({ ...base, ...patch });
    pendingRef.current++;
    setSaving(true);
    setError("");
    const run = queueRef.current.then(async () => {
      const a = agentRef.current!;
      let ok = false;
      try {
        const res = await api.request("agents.save", {
          slug,
          keepalive,
          // Full agent with the changed part in it; an absent skills key = all skills.
          body: {
            name: a.name,
            emoji: a.emoji,
            description: a.description,
            harness: a.harness,
            model: a.model,
            effort: a.effort,
            group: a.group,
            system: a.system,
            workflows: a.workflows,
            knowledge: a.knowledge,
            vibeables: a.vibeables,
            skills: a.skills,
          },
        });
        ok = res.ok;
        if (!res.ok) setError(failure(res));
        else if (pendingRef.current === 1) show(res.data);
      } catch (err) {
        setError((err as Error).message);
      }
      if (!ok) {
        // Not saved: back to what the server has.
        const stored = await api.call("agents.get", { slug }).catch(() => null);
        if (stored && pendingRef.current === 1) show(stored);
      }
      pendingRef.current--;
      if (pendingRef.current === 0) setSaving(false);
      return ok;
    });
    queueRef.current = run;
    return run;
  }

  /** The role as typed, saved when it differs; a failed save keeps the text in the field. */
  async function commitRole(keepalive = false): Promise<void> {
    const text = roleRef.current;
    const a = agentRef.current;
    if (text === null || !a) return;
    if (text.trim() !== (a.system ?? "").trim() && !(await save({ system: text }, keepalive))) return;
    if (roleRef.current === text) editRole(null);
  }
  // Closing the page (escape in the modal) with the role still in the field saves it too.
  useEffect(
    () => () => {
      void commitRole(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function setArchived(archived: boolean): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await api.request("agents.archive", { slug, body: { archived } });
      if (!r.ok) setError(failure(r));
      else show(r.data);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  if (gone) return <EmptyState icon="person_off">agent not found</EmptyState>;
  if (!agent) return <EmptyState>loading…</EmptyState>;

  const toggle = (kind: Kind) => () => {
    setEditing(editing === kind ? "" : kind);
    setError("");
  };
  /** One tick in a checklist: the list with or without the name, saved right away. */
  const tick = (kind: Exclude<Kind, "skills">, name: string, on: boolean) => {
    const list = agent[kind] ?? [];
    void save({ [kind]: on ? [...list.filter((n) => n !== name), name] : list.filter((n) => n !== name) });
  };
  const tickSkill = (name: string, on: boolean) => {
    const list = agent.skills ?? [];
    void save({ skills: on ? [...list.filter((n) => n !== name), name] : list.filter((n) => n !== name) });
  };
  const roleText = role ?? agent.system ?? "";
  const roleDirty = role !== null && role.trim() !== (agent.system ?? "").trim();
  const folders = agent.files ?? [];
  // A fact of the side column: the height of a control, so the rows line up with pages that edit theirs.
  const FACT = "m-0 flex min-h-8 min-w-0 items-center gap-1.5 px-2 [overflow-wrap:anywhere]";
  const unset = (text: string) => <span className="text-fg-2">{text}</span>;

  return (
    // @container: the page folds to one column by its own width — it is also shown in the edit modal.
    <div className="agent-view @container flex animate-rise flex-col gap-4">
      <header className="flex items-center gap-3.5">
        <Avatar>
          <span aria-hidden>{agent.emoji}</span>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Title size="lg">{agent.name}</Title>
            {agent.archived && (
              <Tag>
                <Icon name="inventory_2" className="ms-sm mr-1" /> archived
              </Tag>
            )}
          </div>
          {agent.description && <p className="m-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{agent.description}</p>}
        </div>
      </header>
      {error && <Notice tone="bad">{error}</Notice>}

      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 @[880px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-sm font-semibold text-fg">What the agent is told</h3>
              {(roleDirty || (saving && role !== null)) && <span className="text-xs text-fg-2">{saving ? "saving…" : "unsaved"}</span>}
              <span className="flex-1" />
              <span className={SUB}>agents/{agent.slug}/system.md</span>
            </div>
            <TextArea
              className={CODE_AREA}
              aria-label="role"
              rows={Math.min(24, Math.max(8, roleText.split("\n").length + 2))}
              value={roleText}
              placeholder={"You are the ... for this project. Your job is ..."}
              onChange={(e) => editRole(e.target.value)}
              onBlur={() => void commitRole()}
              spellCheck={false}
            />
          </section>

          <Linked title="Workflows" kind="workflows" editing={editing === "workflows"} saving={saving} onToggle={toggle("workflows")}>
            {editing === "workflows" ? (
              <Checks>
                {(wfData?.workflows ?? []).map((w) => (
                  <Checkbox key={w.slug} checked={agent.workflows.includes(w.slug)} onChange={(on) => tick("workflows", w.slug, on)} hint={w.description} mono>{w.slug}</Checkbox>
                ))}
                {(wfData?.workflows ?? []).length === 0 && <Hint className="py-1.5 px-0">no workflows in this project</Hint>}
              </Checks>
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
          </Linked>

          <Linked title="Knowledge" kind="knowledge" editing={editing === "knowledge"} saving={saving} onToggle={toggle("knowledge")}>
            {editing === "knowledge" ? (
              <Checks>
                {(kData?.bundles ?? []).map((b) => (
                  <Checkbox key={b.name} checked={agent.knowledge.includes(b.name)} onChange={(on) => tick("knowledge", b.name, on)} hint={`${b.concepts} concepts`} mono>{b.name}</Checkbox>
                ))}
                {(kData?.bundles ?? []).length === 0 && <Hint className="py-1.5 px-0">no knowledge bundles in this project</Hint>}
              </Checks>
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
          </Linked>

          {(features.vibeables || (agent.vibeables ?? []).length > 0) && (
            <Linked title="Apps" kind="vibeables" editing={editing === "vibeables"} saving={saving} onToggle={toggle("vibeables")}>
              {editing === "vibeables" ? (
                <Checks>
                  {(vData?.vibeables ?? []).map((v) => (
                    <Checkbox key={v.slug} checked={(agent.vibeables ?? []).includes(v.slug)} onChange={(on) => tick("vibeables", v.slug, on)} hint={v.dev ? "dev" : "static"} mono>{v.slug}</Checkbox>
                  ))}
                  {/* A linked app that is gone is listed so unticking removes it; it just has no folder to show. */}
                  {(agent.vibeables ?? [])
                    .filter((slug) => !(vData?.vibeables ?? []).some((v) => v.slug === slug))
                    .map((slug) => (
                      <Checkbox key={slug} checked onChange={(on) => tick("vibeables", slug, on)} hint="not found in this workspace" mono>{slug}</Checkbox>
                    ))}
                  {!features.vibeables && <Hint className="py-1.5 px-0">vibeables are off in this workspace's settings</Hint>}
                  {features.vibeables && (vData?.vibeables ?? []).length === 0 && (
                    <Hint className="py-1.5 px-0">no apps in this workspace yet — create one on the apps page</Hint>
                  )}
                </Checks>
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
            </Linked>
          )}

          {/* The folders in agent.yml (files:), read here: the profile names everything the agent works with. */}
          {folders.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="m-0 text-sm font-semibold text-fg">Folders</h3>
              <Chips>
                {folders.map((f) => (
                  <Tag key={f} className="font-mono">{f}</Tag>
                ))}
              </Chips>
            </section>
          )}

          <Linked title="Shared skills" kind="skills" editing={editing === "skills"} saving={saving} onToggle={toggle("skills")}>
            {editing === "skills" ? (
              <Checks>
                {/* Unticked, the list starts as every skill there is now: nothing is taken away until a skill is unticked. */}
                <Checkbox
                  checked={agent.skills === undefined}
                  onChange={(all) => void save({ skills: all ? undefined : (sData?.skills ?? []).map((s) => s.name) })}
                  hint="every discovered skill, including future ones"
                  mono
                >
                  all skills
                </Checkbox>
                {agent.skills !== undefined &&
                  (sData?.skills ?? []).map((s) => (
                    <Checkbox key={s.name} checked={(agent.skills ?? []).includes(s.name)} onChange={(on) => tickSkill(s.name, on)} hint={s.description} mono>{`/${s.name}`}</Checkbox>
                  ))}
                {agent.skills !== undefined && (sData?.skills ?? []).length === 0 && (
                  <Hint className="py-1.5 px-0">no skills found (.claude/skills, project or user)</Hint>
                )}
              </Checks>
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
          </Linked>

          <AgentSkillsPanel slug={slug} />
          <RoutinesPanel slug={slug} />
        </div>

        {/* The facts: beside the profile on a wide page, right under the name on a narrow one. */}
        <aside className="order-first flex min-w-0 flex-col gap-3 @[880px]:order-none" aria-label="details">
          <dl className="m-0 grid grid-cols-[76px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm @min-[520px]:@max-[879px]:grid-cols-[76px_minmax(0,1fr)_76px_minmax(0,1fr)]">
            <dt className="text-fg-2">Group</dt>
            <dd className={FACT}>{agent.group || unset("none")}</dd>
            <dt className="text-fg-2">Harness</dt>
            <dd className={FACT}>{agent.harness}</dd>
            <dt className="text-fg-2">Model</dt>
            <dd className={FACT}>{agent.model || unset("harness default")}</dd>
            <dt className="text-fg-2">Effort</dt>
            <dd className={FACT}>{agent.effort || unset("default")}</dd>
            <dt className="text-fg-2">State</dt>
            <dd className={FACT}>
              {agent.archived ? "archived" : "active"}
              {agent.archived ? (
                <Button size="sm" variant="quiet" icon="unarchive" busy={saving} title="Put this agent back on the roster" onClick={() => void setArchived(false)}>
                  unarchive
                </Button>
              ) : (
                <Button size="sm" variant="quiet" icon="archive" disabled={saving} title="Hide this agent from the roster — restorable any time" onClick={() => void setArchived(true)}>
                  archive
                </Button>
              )}
            </dd>
          </dl>
          {/* Name, emoji, description and the facts above are changed in the full editor. */}
          <div className="flex flex-wrap items-center gap-2 px-2">
            <Button size="sm" icon="edit" href={`/agents/${encodeURIComponent(slug)}/edit`} title="name, emoji, description, group, harness, model and effort">
              edit
            </Button>
            <code className="font-mono text-2xs text-fg-2 [overflow-wrap:anywhere]" title="the agent's folder">agents/{agent.slug}</code>
          </div>
        </aside>
      </div>
    </div>
  );
}
