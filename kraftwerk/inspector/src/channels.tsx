import { useEffect, useState } from "react";
import type { Agent, Channel } from "./types";
import { ChatThread } from "./chat";
import { Icon, Link, navigate, usePoll, fmtWhen } from "./shared";

/**
 * Channels: shared transcripts where several agents (and humans) talk, like
 * a Slack channel whose coworkers are agents. Left: the channel list; main:
 * the thread (ChatThread in channel mode) or the new-channel form.
 * Routes: #/channels, #/channels/new, #/channels/<slug>[/edit].
 */

export type ChannelView = Channel & { chatId: string; busy: boolean; awaitingApproval: boolean; updatedAt: string };

export function ChannelsScreen({ seg }: { seg: string[] }) {
  const slug = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const mode = seg[0] === "new" ? "new" : slug && seg[1] === "edit" ? "edit" : slug ? "channel" : "home";
  const data = usePoll<{ root: string; channels: ChannelView[] }>("/api/channels", false, 4000);
  const agents = usePoll<{ agents: Agent[] }>("/api/agents", false, 15_000);
  const channels = data?.channels ?? [];
  const current = slug ? channels.find((c) => c.slug === slug) : undefined;

  let main: React.ReactNode;
  if (mode === "new") main = <ChannelEditor agents={agents?.agents ?? []} />;
  else if (mode === "edit" && current) main = <ChannelEditor key={current.slug} channel={current} agents={agents?.agents ?? []} />;
  else if (mode === "channel" && current)
    main = (
      <div className="chat-main">
        <ChatThread key={current.chatId} id={current.chatId} channel={current} agents={agents?.agents ?? []} />
      </div>
    );
  else if (mode === "channel" && data) main = <div className="empty">channel not found</div>;
  else if (mode === "channel") main = <div className="empty">loading…</div>;
  else main = <ChannelsHome count={channels.length} root={data?.root} />;

  return (
    <div className="runs-screen channels-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">channels</span>
          <span className="spacer" />
          <Link href="/channels/new" className="open-raw">
            <Icon name="add" className="ms-sm" /> new
          </Link>
        </div>
        <div className="side-list">
          {channels.map((c) => (
            <Link key={c.slug} href={`/channels/${encodeURIComponent(c.slug)}`} className={`side-row ${c.slug === slug ? "active" : ""}`}>
              <span className={`lamp ${c.awaitingApproval ? "blocked" : c.busy ? "running" : "pending"}`} title={c.awaitingApproval ? "waiting for your approval" : c.busy ? "an agent is working" : undefined} />
              <div className="side-row-body">
                <div className="side-row-top">
                  <span className="side-wf">#{c.slug}</span>
                </div>
                <div className="side-row-sub">
                  <span className="side-req">{c.name}{c.members.length ? ` · ${c.members.map((m) => `@${m}`).join(" ")}` : ""}</span>
                  <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
          {data && channels.length === 0 && <div className="viewer-note">no channels yet — create one, or add a coworker to an agent session</div>}
        </div>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}

function ChannelsHome({ count, root }: { count: number; root?: string }) {
  return (
    <div className="new-chat">
      <div className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">channels</span>
        </div>
        <div className="panel-body" style={{ display: "grid", gap: 12 }}>
          <p>
            A channel is a shared conversation with several agents at once — a Slack channel where the coworkers are
            agents. @mention an agent to wake it; agents hand work to each other by mentioning; a channel can name one
            responder that answers when nobody is mentioned.
          </p>
          <p>
            {count === 0 ? "No channels yet. " : `${count} channel${count === 1 ? "" : "s"}. `}
            Definitions live in <code>{root ?? "channels/"}</code> and travel with the workspace.
          </p>
          <div>
            <Link href="/channels/new" className="run-btn">
              <Icon name="add" className="ms-sm" /> new channel
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Create or edit a channel: name, purpose, members (agents), responder. */
export function ChannelEditor({ channel, agents }: { channel?: ChannelView; agents: Agent[] }) {
  const [name, setName] = useState(channel?.name ?? "");
  const [purpose, setPurpose] = useState(channel?.purpose ?? "");
  const [members, setMembers] = useState<string[]>(channel?.members ?? []);
  const [responder, setResponder] = useState(channel?.responder ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = agents.filter((a) => !a.archived);

  function toggle(slug: string, on: boolean): void {
    setMembers((prev) => (on ? [...prev.filter((m) => m !== slug), slug] : prev.filter((m) => m !== slug)));
    if (!on && responder === slug) setResponder("");
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(channel ? `/api/channels/${encodeURIComponent(channel.slug)}` : "/api/channels", {
        method: channel ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, purpose, members, responder: responder || null }),
      });
      const d = (await r.json()) as ChannelView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      navigate(`/channels/${encodeURIComponent(d.slug)}`);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  async function remove(): Promise<void> {
    if (!channel) return;
    if (!window.confirm(`Delete #${channel.slug} and its transcript?`)) return;
    await fetch(`/api/channels/${encodeURIComponent(channel.slug)}`, { method: "DELETE" }).catch(() => {});
    navigate("/channels");
  }

  return (
    <div className="new-chat">
      <div className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">{channel ? `edit #${channel.slug}` : "new channel"}</span>
          <span className="spacer" />
          {channel && (
            <button className="open-raw" onClick={() => void remove()}>
              <Icon name="delete" className="ms-sm" /> delete
            </button>
          )}
        </div>
        <div className="agent-form">
          <label className="agent-field">
            name
            <input value={name} placeholder="e.g. Website relaunch" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="agent-field">
            purpose — one line the agents read
            <input value={purpose} placeholder="what this channel is for" onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <div className="agent-field">
            members — agents in this channel
            <div className="wf-checks">
              {active.map((a) => (
                <label key={a.slug}>
                  <input type="checkbox" checked={members.includes(a.slug)} onChange={(e) => toggle(a.slug, e.target.checked)} />
                  <b>{a.emoji} {a.name}</b>
                  <span className="opt-hint"> — @{a.slug}{a.description ? ` · ${a.description}` : ""}</span>
                </label>
              ))}
              {active.length === 0 && <div className="viewer-note">no agents yet — create one on the agents screen first</div>}
            </div>
          </div>
          <label className="agent-field">
            responder — answers when a message mentions nobody
            <select value={responder} onChange={(e) => setResponder(e.target.value)}>
              <option value="">nobody (agents only answer when @mentioned)</option>
              {members.map((m) => (
                <option key={m} value={m}>@{m}</option>
              ))}
            </select>
          </label>
          {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
          <div className="agent-form-row">
            <button className="run-btn" disabled={saving || !name.trim() || members.length === 0} onClick={() => void save()}>
              {saving ? "saving…" : channel ? "save" : "create channel"}
            </button>
            <Link href={channel ? `/channels/${encodeURIComponent(channel.slug)}` : "/channels"} className="open-raw">
              cancel
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Add a coworker" from an agent session: the session becomes a channel
 * with this agent plus the ones picked here. Everything said so far stays.
 */
export function AddCoworkerDialog({ chatId, agentSlug, title, onClose }: { chatId: string; agentSlug: string; title: string; onClose: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState(title || "");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: Agent[] }) => setAgents(d.agents.filter((a) => !a.archived && a.slug !== agentSlug)))
      .catch(() => {});
  }, [agentSlug]);

  async function create(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/channels/from-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, name, members: [agentSlug, ...picked], responder: agentSlug }),
      });
      const d = (await r.json()) as { slug?: string; error?: string };
      if (!r.ok || !d.slug) throw new Error(d.error ?? `HTTP ${r.status}`);
      onClose();
      navigate(`/channels/${encodeURIComponent(d.slug)}`);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Add a coworker">
        <div className="panel-head">
          <span className="microlabel">add a coworker</span>
          <span className="spacer" />
          <button className="open-raw" onClick={onClose}><Icon name="close" className="ms-sm" /></button>
        </div>
        <div className="agent-form">
          <p className="viewer-note">
            This session becomes a channel: @{agentSlug} stays and keeps its memory, the agents you pick join, and
            everyone reads the same transcript. @{agentSlug} answers when nobody is mentioned.
          </p>
          <label className="agent-field">
            channel name
            <input value={name} placeholder="e.g. Website relaunch" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="agent-field">
            invite
            <div className="wf-checks">
              {agents.map((a) => (
                <label key={a.slug}>
                  <input
                    type="checkbox"
                    checked={picked.includes(a.slug)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.slug] : p.filter((x) => x !== a.slug)))}
                  />
                  <b>{a.emoji} {a.name}</b>
                  <span className="opt-hint"> — @{a.slug}{a.description ? ` · ${a.description}` : ""}</span>
                </label>
              ))}
              {agents.length === 0 && <div className="viewer-note">no other agents to invite yet</div>}
            </div>
          </div>
          {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
          <div className="agent-form-row">
            <button className="run-btn" disabled={saving || !name.trim() || picked.length === 0} onClick={() => void create()}>
              {saving ? "creating…" : "create channel"}
            </button>
            <button className="open-raw" onClick={onClose}>cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
