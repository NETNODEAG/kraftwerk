import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  BundleDetail,
  ChatMeta,
  ConceptDetail,
  KnowledgeIndex,
  RoutineStatus,
  SkillInfo,
  TeamMember,
  TeamMemberDetail,
  WorkflowSummary,
} from "./types";
import { ChatThread, createChatAndOpen } from "./chat";
import { Link, navigate, usePoll, fmtWhen } from "./shared";

/**
 * Team: persistent agent teammates ("employees"), each defined in
 * agents/<slug>/ (agent.yml + system.md). The screen is a double sidebar:
 * members on the left, the selected member's sessions next to it, and the
 * main pane shows the member profile, a session thread, or the editor.
 * Sessions are ordinary chats with scope { kind: "team", member } — the
 * thread view is reused from the chat screen.
 */

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const EMOJI_PRESETS = ["🤖", "🧑‍💻", "🎧", "🛠️", "📊", "✍️", "🔍", "🧹", "📦", "🚀"];

export function TeamScreen({ seg }: { seg: string[] }) {
  // seg (after /team): [] | [new] | [slug] | [slug, edit] | [slug, chat, chatId]
  const slug = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const mode =
    seg[0] === "new" ? "new" : seg[1] === "edit" ? "edit" : seg[1] === "chat" ? "chat" : slug ? "member" : "home";
  const chatId = mode === "chat" ? seg[2] : undefined;

  const data = usePoll<{ root: string; members: TeamMember[] }>("/api/team", false);
  const members = data?.members ?? [];

  let main: React.ReactNode;
  if (mode === "new") main = <MemberEditor key="new" />;
  else if (mode === "edit" && slug) main = <MemberEditor key={slug} slug={slug} />;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ChatThread key={chatId} id={chatId} />
      </div>
    );
  else if (slug) main = <MemberView key={slug} slug={slug} />;
  else main = <TeamHome hasMembers={members.length > 0} root={data?.root} />;

  // Linked knowledge bundles of the selected agent → right sidebar on the
  // profile and chat views (not while editing). Hidden state persists.
  const kBundles =
    (mode === "member" || mode === "chat") && slug
      ? (members.find((m) => m.slug === slug)?.knowledge ?? [])
      : [];
  const [kOpen, setKOpen] = useState(() => localStorage.getItem("kw-kside") !== "hidden");
  const [kWidth, setKWidth] = useState(() => Number(localStorage.getItem("kw-kside-w")) || 460);
  const showKnowledge = kBundles.length > 0 && kOpen;
  function toggleKnowledge(open: boolean): void {
    setKOpen(open);
    localStorage.setItem("kw-kside", open ? "open" : "hidden");
  }
  function resizeKnowledge(w: number): void {
    setKWidth(w);
    localStorage.setItem("kw-kside-w", String(w));
  }

  return (
    <div
      className={`runs-screen team-screen ${slug ? "has-sessions" : ""} ${showKnowledge ? "has-knowledge" : ""}`}
      style={showKnowledge ? ({ "--kside-w": `${kWidth}px` } as React.CSSProperties) : undefined}
    >
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">agents</span>
          <span className="spacer" />
          <Link href="/team/new" className="open-raw">
            + new
          </Link>
        </div>
        <div className="side-list">
          {members.map((m) => (
            <Link
              key={m.slug}
              href={`/team/${encodeURIComponent(m.slug)}`}
              className={`side-row ${m.slug === slug ? "active" : ""}`}
            >
              <span className="team-emoji">{m.emoji}</span>
              <div className="side-row-body">
                <div className="side-row-top">
                  <span className="side-wf">{m.name}</span>
                </div>
                <div className="side-row-sub">
                  <span className="side-req">{m.description || m.harness}</span>
                </div>
              </div>
            </Link>
          ))}
          {data && members.length === 0 && <div className="viewer-note">no agents yet</div>}
        </div>
      </aside>
      {slug && <SessionsSide slug={slug} chatId={chatId} />}
      <div className="runs-main">{main}</div>
      {showKnowledge && (
        <KnowledgeSide bundles={kBundles} onHide={() => toggleKnowledge(false)} onResize={resizeKnowledge} />
      )}
      {kBundles.length > 0 && !kOpen && (
        <button className="kside-reopen" onClick={() => toggleKnowledge(true)} title="Show knowledge sidebar">
          ◆ knowledge
        </button>
      )}
    </div>
  );
}

/* ---------- knowledge sidebar ---------- */

function KnowledgeSide({
  bundles,
  onHide,
  onResize,
}: {
  bundles: string[];
  onHide: () => void;
  onResize: (w: number) => void;
}) {
  const [details, setDetails] = useState<Record<string, BundleDetail | null>>({});
  const [openId, setOpenId] = useState<string | null>(null); // "<bundle>::<concept id>"
  // key -> full concept (null = failed to load); rendered html derives from it.
  const [concepts, setConcepts] = useState<Record<string, ConceptDetail | null>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setDetails({});
    for (const b of bundles) {
      fetch(`/api/knowledge/${encodeURIComponent(b)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: BundleDetail | null) => setDetails((prev) => ({ ...prev, [b]: d })))
        .catch(() => setDetails((prev) => ({ ...prev, [b]: null })));
    }
  }, [bundles.join(",")]);

  async function toggle(bundle: string, id: string): Promise<void> {
    const key = `${bundle}::${id}`;
    if (openId === key) {
      setOpenId(null);
      return;
    }
    setOpenId(key);
    if (concepts[key] !== undefined) return;
    try {
      const r = await fetch(
        `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(id)}`
      );
      const concept = r.ok ? ((await r.json()) as ConceptDetail) : null;
      setConcepts((prev) => ({ ...prev, [key]: concept }));
    } catch {
      setConcepts((prev) => ({ ...prev, [key]: null }));
    }
  }

  // Saves the full raw file (frontmatter + body) — the server stamps
  // provenance as human:user, same as the knowledge screen's editor.
  async function save(bundle: string, id: string): Promise<void> {
    const key = `${bundle}::${id}`;
    setSaving(true);
    setSaveError("");
    try {
      const r = await fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, content: draft }),
      });
      const body = (await r.json()) as ConceptDetail & { error?: string };
      if (body.error) {
        setSaveError(body.error);
      } else {
        setConcepts((prev) => ({ ...prev, [key]: body }));
        setEditKey(null);
      }
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  }

  return (
    <aside className="runs-side knowledge-side">
      <div
        className="kside-resizer"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = (e.currentTarget.parentElement as HTMLElement).offsetWidth;
          const move = (ev: MouseEvent) =>
            onResize(Math.min(900, Math.max(280, startW + (startX - ev.clientX))));
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      />
      <div className="side-head">
        <span className="microlabel">knowledge</span>
        <span className="spacer" />
        <button className="open-raw" onClick={onHide} title="Hide knowledge sidebar">
          hide ✕
        </button>
      </div>
      <div className="side-list">
        {bundles.map((b) => {
          const detail = details[b];
          return (
            <div key={b} className="kside-bundle">
              <Link href={`/knowledge/${encodeURIComponent(b)}`} className="kside-bundle-name">
                {b} {detail ? <span className="num">({detail.concepts.length})</span> : null}
              </Link>
              {detail === null && <div className="viewer-note">bundle not found</div>}
              {detail?.concepts.map((c) => {
                const key = `${b}::${c.id}`;
                const open = openId === key;
                return (
                  <div key={c.id} className="kside-concept">
                    <button className={`kside-row ${open ? "active" : ""}`} onClick={() => toggle(b, c.id)}>
                      <span className="kside-title">{c.title || c.id}</span>
                      {c.stale && <span className="kside-stale">stale</span>}
                    </button>
                    {open && editKey !== key && (
                      <div className="kside-body md-body">
                        {concepts[key] === undefined ? (
                          <span className="viewer-note">loading…</span>
                        ) : concepts[key] === null ? (
                          <span className="viewer-note">could not load concept</span>
                        ) : (
                          <>
                            <div className="kside-actions">
                              <button
                                className="open-raw"
                                onClick={() => {
                                  setDraft(concepts[key]!.raw);
                                  setEditKey(key);
                                  setSaveError("");
                                }}
                              >
                                ✎ edit
                              </button>
                            </div>
                            <div
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(
                                  marked.parse(concepts[key]!.body ?? "", { async: false })
                                ),
                              }}
                            />
                          </>
                        )}
                      </div>
                    )}
                    {open && editKey === key && (
                      <div className="kside-body kside-edit">
                        <textarea
                          className="concept-edit"
                          value={draft}
                          rows={Math.min(28, Math.max(10, draft.split("\n").length + 2))}
                          onChange={(e) => setDraft(e.target.value)}
                          spellCheck={false}
                        />
                        <div className="kside-actions">
                          <button className="open-raw" disabled={saving} onClick={() => setEditKey(null)}>
                            cancel
                          </button>
                          <button className="open-raw" disabled={saving} onClick={() => save(b, c.id)}>
                            {saving ? "saving…" : "✓ save"}
                          </button>
                        </div>
                        {saveError && <div className="msg error">✕ {saveError}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              {detail && detail.concepts.length === 0 && (
                <div className="viewer-note">no concepts yet</div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ---------- sessions sidebar ---------- */

function SessionsSide({ slug, chatId }: { slug: string; chatId?: string }) {
  const data = usePoll<{ chats: Array<ChatMeta & { busy: boolean }> }>("/api/chats", false);
  const sessions = (data?.chats ?? []).filter(
    (c) => c.scope.kind === "team" && c.scope.member === slug
  );
  const [creating, setCreating] = useState(false);

  return (
    <aside className="runs-side">
      <div className="side-head">
        <span className="microlabel">sessions</span>
        <span className="spacer" />
        <button
          className="open-raw"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "team", member: slug });
            setCreating(false);
          }}
        >
          {creating ? "…" : "+ new"}
        </button>
      </div>
      <div className="side-list">
        {sessions.map((c) => (
          <Link
            key={c.id}
            href={`/team/${encodeURIComponent(slug)}/chat/${c.id}`}
            className={`side-row ${c.id === chatId ? "active" : ""}`}
          >
            <span className={`lamp ${c.busy ? "running" : "pending"}`} />
            <div className="side-row-body">
              <div className="side-row-top">
                <span className="side-wf">{c.title || "new session"}</span>
              </div>
              <div className="side-row-sub">
                <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
              </div>
            </div>
            <button
              type="button"
              className="row-x"
              title="delete session"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!window.confirm(`Delete session "${c.title || c.id}"?`)) return;
                await fetch(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
                if (c.id === chatId) navigate(`/team/${encodeURIComponent(slug)}`);
              }}
            >
              ✕
            </button>
          </Link>
        ))}
        {data && sessions.length === 0 && <div className="viewer-note">no sessions yet</div>}
      </div>
    </aside>
  );
}

/* ---------- home ---------- */

function TeamHome({ hasMembers, root }: { hasMembers: boolean; root?: string }) {
  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>agents</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">what lives here</span>
        </div>
        <div className="know-intro">
          Your agents, set up like teammates: each one has a name, a role (system prompt), a
          harness/model to run on, and the workflows that belong to its job. An agent lives in{" "}
          <code>{root ? `${root}/<slug>/` : "agents/<slug>/"}</code> as <code>agent.yml</code> +{" "}
          <code>system.md</code> — git-tracked, so your team travels with the repo. Every session
          is a persistent conversation with that agent; it knows its connected workflows and
          knowledge bundles, runs the workflows for you, and keeps the knowledge current.
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <button className="run-btn" onClick={() => navigate("/team/new")}>
            {hasMembers ? "+ new agent" : "create your first agent"}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- member profile ---------- */

function MemberView({ slug }: { slug: string }) {
  const [member, setMember] = useState<TeamMemberDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/team/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => alive && setMember(m))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (gone) return <div className="empty">agent not found</div>;
  if (!member) return <div className="empty">loading…</div>;

  return (
    <div className="member-view">
      <div className="detail-head">
        <span className="team-emoji-lg">{member.emoji}</span>
        <h1>{member.name}</h1>
        <span className="chip agent">{member.harness}</span>
        {member.model && <span className="chip">{member.model}</span>}
        {member.effort && <span className="chip">effort: {member.effort}</span>}
        <span className="spacer" />
        <Link href={`/team/${encodeURIComponent(slug)}/edit`} className="open-raw">
          edit
        </Link>
        <button
          className="run-btn"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "team", member: slug });
            setCreating(false);
          }}
        >
          {creating ? "starting…" : "new session"}
        </button>
      </div>
      <section className="panel">
        <div className="m3-list">
          <button type="button" className="m3-row m3-toggle" onClick={() => setRoleOpen(!roleOpen)}>
            <span className="m3-ico">▤</span>
            <span className="m3-body">
              <span className="m3-head">role</span>
              {!roleOpen && (
                <span className="m3-sub m3-ellipsis">
                  {(member.system || "").trim().split("\n")[0] ||
                    "empty — edit this agent to give it a role"}
                </span>
              )}
            </span>
            <span className={`m3-chev ${roleOpen ? "open" : ""}`}>▾</span>
          </button>
          {roleOpen && (
            <div className="m3-expand">
              <pre>{member.system || "(empty — edit this agent to give it a role)"}</pre>
              <div className="m3-sub" style={{ marginTop: 10 }}>
                agents/{member.slug}/system.md
              </div>
            </div>
          )}
          <div className="m3-row">
            <span className="m3-ico">⚙</span>
            <span className="m3-body">
              <span className="m3-head">workflows</span>
              {member.workflows.length === 0 ? (
                <span className="m3-sub">none connected — the agent can run any workflow you connect</span>
              ) : (
                <span className="m3-chips">
                  {member.workflows.map((w) => (
                    <Link key={w} href={`/workflows/${encodeURIComponent(w)}`} className="chip">
                      {w}
                    </Link>
                  ))}
                </span>
              )}
            </span>
            <Link href={`/team/${encodeURIComponent(slug)}/edit`} className="open-raw">
              edit
            </Link>
          </div>
          <div className="m3-row">
            <span className="m3-ico">◆</span>
            <span className="m3-body">
              <span className="m3-head">knowledge</span>
              {member.knowledge.length === 0 ? (
                <span className="m3-sub">none connected — connected bundles are read and kept current by the agent</span>
              ) : (
                <span className="m3-chips">
                  {member.knowledge.map((b) => (
                    <Link key={b} href={`/knowledge/${encodeURIComponent(b)}`} className="chip">
                      {b}
                    </Link>
                  ))}
                </span>
              )}
            </span>
            <Link href={`/team/${encodeURIComponent(slug)}/edit`} className="open-raw">
              edit
            </Link>
          </div>
          <div className="m3-row">
            <span className="m3-ico">/</span>
            <span className="m3-body">
              <span className="m3-head">skills</span>
              {member.skills === undefined ? (
                <span className="m3-sub">all discovered skills (default) — invoke with /name in a session</span>
              ) : member.skills.length === 0 ? (
                <span className="m3-sub">none — this agent runs without skills</span>
              ) : (
                <span className="m3-chips">
                  {member.skills.map((s) => (
                    <span key={s} className="chip">
                      /{s}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <Link href={`/team/${encodeURIComponent(slug)}/edit`} className="open-raw">
              edit
            </Link>
          </div>
        </div>
      </section>

      <RoutinesPanel slug={slug} />
    </div>
  );
}

/* ---------- routines ---------- */

interface RoutineForm {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

function RoutinesPanel({ slug }: { slug: string }) {
  const data = usePoll<{ routines: RoutineStatus[] }>(
    `/api/team/${encodeURIComponent(slug)}/routines`,
    false
  );
  const routines = data?.routines ?? [];
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function post(routine: RoutineForm): Promise<boolean> {
    setError("");
    const res = await fetch(`/api/team/${encodeURIComponent(slug)}/routines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routine),
    });
    const body = await res.json();
    if (body.error) {
      setError(body.error);
      return false;
    }
    return true;
  }

  async function runNow(id: string) {
    setBusyId(id);
    setError("");
    const res = await fetch(
      `/api/team/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}/run`,
      { method: "POST" }
    );
    const body = await res.json();
    setBusyId("");
    if (body.error) setError(body.error);
    else if (body.chatId) navigate(`/team/${encodeURIComponent(slug)}/chat/${body.chatId}`);
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete routine "${id}"?`)) return;
    await fetch(`/api/team/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">routines — scheduled prompts</span>
        <span className="spacer" />
        {!form && (
          <button
            className="open-raw"
            onClick={() => setForm({ name: "", schedule: "0 9 * * 1-5", prompt: "", enabled: true })}
          >
            + new routine
          </button>
        )}
      </div>
      {routines.length === 0 && !form && (
        <div className="viewer-note">
          none — a routine messages this agent on a schedule (cron, server local time) and each run
          opens a new session with the result.
        </div>
      )}
      {routines.length > 0 && (
        <div className="m3-list">
          {routines.map((r) => (
            <div key={r.id} className="m3-row">
              <span className="m3-ico">◷</span>
              <span className="m3-body">
                <span className="m3-head">
                  {r.name}
                  {r.lastError && (
                    <span className="chip stale" title={r.lastError}>
                      error
                    </span>
                  )}
                </span>
                <span className="m3-sub">
                  <code>{r.schedule}</code>
                  {!r.enabled
                    ? " · paused"
                    : r.nextRunAt
                      ? ` · next ${fmtWhen(r.nextRunAt)}`
                      : ""}
                  {" · "}
                  {r.lastChatId ? (
                    <Link href={`/team/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}>
                      last run {fmtWhen(r.lastRunAt)}
                    </Link>
                  ) : (
                    "never ran"
                  )}
                </span>
              </span>
              <button className="open-raw" disabled={busyId === r.id} onClick={() => runNow(r.id)}>
                {busyId === r.id ? "starting…" : "▶ run"}
              </button>
              <button
                className="open-raw"
                onClick={() =>
                  setForm({
                    id: r.id,
                    name: r.name,
                    schedule: r.schedule,
                    prompt: r.prompt,
                    enabled: r.enabled,
                  })
                }
              >
                edit
              </button>
              <button className="open-raw" onClick={() => void remove(r.id)}>
                delete
              </button>
              <label
                className="m3-switch"
                title={r.enabled ? "enabled — click to pause" : "paused — click to enable"}
              >
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() =>
                    void post({
                      id: r.id,
                      name: r.name,
                      schedule: r.schedule,
                      prompt: r.prompt,
                      enabled: !r.enabled,
                    })
                  }
                />
                <span className="m3-switch-track" />
              </label>
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className="team-form">
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              name
              <input
                value={form.name}
                placeholder="e.g. Morning report"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 200 }}>
              schedule (cron)
              <input
                value={form.schedule}
                placeholder="0 9 * * 1-5"
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              />
            </label>
            <label className="team-field wf-checks" style={{ width: 90 }}>
              enabled
              <label>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                on
              </label>
            </label>
          </div>
          <label className="team-field">
            prompt — what to ask this agent on each run
            <textarea
              rows={5}
              value={form.prompt}
              placeholder="Check ... and summarize what changed."
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <div className="team-form-row">
            <button
              className="run-btn"
              disabled={!form.name.trim() || !form.prompt.trim()}
              onClick={async () => {
                if (await post(form)) setForm(null);
              }}
            >
              {form.id ? "save routine" : "create routine"}
            </button>
            <button className="open-raw" onClick={() => (setForm(null), setError(""))}>
              cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="msg error">✕ {error}</div>}
    </section>
  );
}

/* ---------- editor ---------- */

function MemberEditor({ slug }: { slug?: string }) {
  const [form, setForm] = useState<{
    name: string;
    emoji: string;
    description: string;
    harness: string;
    model: string;
    effort: string;
    system: string;
    workflows: string[];
    knowledge: string[];
    skillsAll: boolean;
    skills: string[];
  } | null>(slug ? null : defaults());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const available = wfData?.workflows ?? [];
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const bundles = kData?.bundles ?? [];
  const sData = usePoll<{ skills: SkillInfo[] }>("/api/skills", false);
  const allSkills = sData?.skills ?? [];

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/team/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: TeamMemberDetail) =>
        setForm({
          name: m.name,
          emoji: m.emoji,
          description: m.description ?? "",
          harness: m.harness,
          model: m.model ?? "",
          effort: m.effort ?? "",
          system: m.system,
          workflows: m.workflows,
          knowledge: m.knowledge ?? [],
          skillsAll: m.skills === undefined,
          skills: m.skills ?? [],
        })
      )
      .catch(() => setError("agent not found"));
  }, [slug]);

  function defaults() {
    return {
      name: "",
      emoji: "🤖",
      description: "",
      harness: "claude",
      model: "",
      effort: "",
      system: "",
      workflows: [] as string[],
      knowledge: [] as string[],
      skillsAll: true,
      skills: [] as string[],
    };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(slug ? `/api/team/${encodeURIComponent(slug)}` : "/api/team", {
      method: slug ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      // skillsAll = no allowlist: omit the skills key entirely.
      body: JSON.stringify({ ...form, skills: form.skillsAll ? undefined : form.skills }),
    });
    const body = await res.json();
    setSaving(false);
    if (body.error) setError(body.error);
    else navigate(`/team/${encodeURIComponent(body.slug)}`);
  }

  async function remove() {
    if (!slug || !window.confirm(`Delete agent "${slug}" and its definition folder?`)) return;
    await fetch(`/api/team/${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(() => {});
    navigate("/team");
  }

  if (!form) return <div className="empty">{error || "loading…"}</div>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>{slug ? `edit ${slug}` : "new agent"}</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="team-form">
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              name
              <input
                value={form.name}
                placeholder="e.g. Max"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 90 }}>
              emoji
              <input value={form.emoji} onChange={(e) => set({ emoji: e.target.value })} />
            </label>
          </div>
          <div className="emoji-pick">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                className={form.emoji === e ? "active" : ""}
                onClick={() => set({ emoji: e })}
              >
                {e}
              </button>
            ))}
          </div>
          <label className="team-field">
            description
            <input
              value={form.description}
              placeholder="one line: what this agent is for"
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <div className="team-form-row">
            <label className="team-field" style={{ width: 140 }}>
              harness
              <select value={form.harness} onChange={(e) => set({ harness: e.target.value })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="pi">pi</option>
              </select>
            </label>
            <label className="team-field" style={{ flex: 1 }}>
              model
              <input
                value={form.model}
                placeholder="harness default — e.g. sonnet, gpt-5.6-sol"
                onChange={(e) => set({ model: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 140 }}>
              effort
              <select value={form.effort} onChange={(e) => set({ effort: e.target.value })}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef || "default"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="team-field">
            system prompt — the agent's role
            <textarea
              rows={10}
              value={form.system}
              placeholder={"You are the ... for this project. Your job is ..."}
              onChange={(e) => set({ system: e.target.value })}
            />
          </label>
          <div className="team-field">
            <span className="team-field-label">connected workflows — autoloaded into the agent's context; it can run them</span>
            <div className="wf-checks">
              {available.map((w) => (
                <label key={w.slug}>
                  <input
                    type="checkbox"
                    checked={form.workflows.includes(w.slug)}
                    onChange={(e) =>
                      set({
                        workflows: e.target.checked
                          ? [...form.workflows, w.slug]
                          : form.workflows.filter((s) => s !== w.slug),
                      })
                    }
                  />
                  <b>{w.slug}</b>
                  {w.description && <span className="opt-hint"> — {w.description}</span>}
                </label>
              ))}
              {available.length === 0 && <div className="viewer-note">no workflows in this project</div>}
            </div>
          </div>
          <div className="team-field">
            <span className="team-field-label">connected knowledge — OKF bundles the agent consults and maintains</span>
            <div className="wf-checks">
              {bundles.map((b) => (
                <label key={b.name}>
                  <input
                    type="checkbox"
                    checked={form.knowledge.includes(b.name)}
                    onChange={(e) =>
                      set({
                        knowledge: e.target.checked
                          ? [...form.knowledge, b.name]
                          : form.knowledge.filter((n) => n !== b.name),
                      })
                    }
                  />
                  <b>{b.name}</b>
                  <span className="opt-hint"> — {b.concepts} concepts</span>
                </label>
              ))}
              {bundles.length === 0 && <div className="viewer-note">no knowledge bundles in this project</div>}
            </div>
          </div>
          <div className="team-field">
            <span className="team-field-label">connected skills — workspace skill packages (see the skills tab); invoked with /name in sessions</span>
            <div className="wf-checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.skillsAll}
                  onChange={(e) => set({ skillsAll: e.target.checked })}
                />
                <b>all skills</b>
                <span className="opt-hint"> — every discovered skill, including future ones</span>
              </label>
              {!form.skillsAll &&
                allSkills.map((s) => (
                  <label key={s.name}>
                    <input
                      type="checkbox"
                      checked={form.skills.includes(s.name)}
                      onChange={(e) =>
                        set({
                          skills: e.target.checked
                            ? [...form.skills, s.name]
                            : form.skills.filter((n) => n !== s.name),
                        })
                      }
                    />
                    <b>/{s.name}</b>
                    {s.description && <span className="opt-hint"> — {s.description}</span>}
                  </label>
                ))}
              {!form.skillsAll && allSkills.length === 0 && (
                <div className="viewer-note">no skills found (.claude/skills, project or user)</div>
              )}
            </div>
          </div>
          {error && <div className="msg error">✕ {error}</div>}
          <div className="team-form-row">
            <button className="run-btn" disabled={!form.name.trim() || saving} onClick={save}>
              {saving ? "saving…" : slug ? "save" : "create"}
            </button>
            <span className="spacer" />
            {slug && (
              <button className="stop-btn" onClick={remove}>
                delete agent
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
