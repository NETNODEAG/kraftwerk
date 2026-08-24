import { useEffect, useState } from "react";
import type {
  ChatMeta,
  KnowledgeIndex,
  RoutineStatus,
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

  return (
    <div className={`runs-screen team-screen ${slug ? "has-sessions" : ""}`}>
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">team</span>
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
    </div>
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
                <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
              </div>
            </div>
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
        <h1>team</h1>
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
    <div>
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
      {member.description && <div className="know-intro" style={{ padding: "0 2px 14px" }}>{member.description}</div>}

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">role — system prompt</span>
          <span className="spacer" />
          <span className="side-meta">agents/{member.slug}/system.md</span>
        </div>
        <div className="viewer-body">
          <pre>{member.system || "(empty — edit this agent to give it a role)"}</pre>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">connected workflows</span>
        </div>
        {member.workflows.length === 0 ? (
          <div className="viewer-note">
            none — connect workflows in the editor and the agent will know it can run them.
          </div>
        ) : (
          <div className="team-wf-list">
            {member.workflows.map((w) => (
              <Link key={w} href={`/workflows/${encodeURIComponent(w)}`} className="chip">
                {w}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">connected knowledge</span>
        </div>
        {member.knowledge.length === 0 ? (
          <div className="viewer-note">
            none — connect knowledge bundles in the editor and the agent will read and maintain them.
          </div>
        ) : (
          <div className="team-wf-list">
            {member.knowledge.map((b) => (
              <Link key={b} href={`/knowledge/${encodeURIComponent(b)}`} className="chip">
                {b}
              </Link>
            ))}
          </div>
        )}
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
        <table className="know-table">
          <tbody>
            {routines.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  {!r.enabled && <span className="chip stale">off</span>}
                  {r.lastError && (
                    <span className="chip stale" title={r.lastError}>
                      error
                    </span>
                  )}
                </td>
                <td className="know-type">
                  <code>{r.schedule}</code>
                </td>
                <td className="know-type">
                  {r.enabled && r.nextRunAt ? `next ${fmtWhen(r.nextRunAt)}` : "—"}
                </td>
                <td className="know-type">
                  {r.lastChatId ? (
                    <Link href={`/team/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}>
                      last {fmtWhen(r.lastRunAt)}
                    </Link>
                  ) : (
                    "never ran"
                  )}
                </td>
                <td className="know-flags">
                  <button className="open-raw" disabled={busyId === r.id} onClick={() => runNow(r.id)}>
                    {busyId === r.id ? "starting…" : "▶ run now"}
                  </button>{" "}
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
                  </button>{" "}
                  <button className="open-raw" onClick={() => void remove(r.id)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  } | null>(slug ? null : defaults());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const available = wfData?.workflows ?? [];
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const bundles = kData?.bundles ?? [];

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
    };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(slug ? `/api/team/${encodeURIComponent(slug)}` : "/api/team", {
      method: slug ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
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
