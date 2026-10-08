import { useEffect, useState } from "react";
import type { Agent, ChannelView } from "./types";
import { ChatThread } from "./chat";
import { api, useApi } from "./api";
import { navigate, fmtWhen } from "./shared";
import { Button, Checkbox, cn, Dot, EmptyState, Eyebrow, Field, IconButton, ListRow, Notice, Page, Panel, Select, SideHead, SideList, SideNote, TextField } from "./ui";

/**
 * Channels: shared transcripts where several agents (and humans) talk, like
 * a Slack channel whose coworkers are agents. Left: the channel list; main:
 * the thread (ChatThread in channel mode) or the new-channel form.
 * Routes: #/channels, #/channels/new, #/channels/<slug>[/edit].
 */

export type { ChannelView };

/** The editor of one channel — or the create form without a slug — on its own (the modal over a conversation). */
export function ChannelEditPage({ slug }: { slug?: string }) {
  const data = useApi("channels.list", {}, { interval: 4000 });
  const agents = useApi("agents.list", {}, { interval: 15_000 });
  const current = slug ? data?.channels.find((c) => c.slug === slug) : undefined;
  if (!slug) return <ChannelEditor agents={agents?.agents ?? []} />;
  if (!data) return <EmptyState>loading…</EmptyState>;
  if (!current) return <EmptyState icon="forum">channel not found</EmptyState>;
  return <ChannelEditor key={current.slug} channel={current} agents={agents?.agents ?? []} />;
}

export function ChannelsScreen({ seg }: { seg: string[] }) {
  const slug = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const mode = seg[0] === "new" ? "new" : slug && seg[1] === "edit" ? "edit" : slug ? "channel" : "home";
  const data = useApi("channels.list", {}, { interval: 4000 });
  const agents = useApi("agents.list", {}, { interval: 15_000 });
  const channels = data?.channels ?? [];
  const current = slug ? channels.find((c) => c.slug === slug) : undefined;

  // #/channels lands on the channel with the latest activity, like #/runs
  // lands on the latest run; only an empty workspace stays on the home.
  const latest = channels.reduce<ChannelView | undefined>((a, c) => (!a || c.updatedAt > a.updatedAt ? c : a), undefined);
  useEffect(() => {
    if (mode === "home" && latest) navigate(`/channels/${encodeURIComponent(latest.slug)}`, { replace: true });
  }, [mode, latest?.slug]);

  let main: React.ReactNode;
  if (mode === "new") main = <ChannelEditor agents={agents?.agents ?? []} />;
  else if (mode === "edit" && current) main = <ChannelEditor key={current.slug} channel={current} agents={agents?.agents ?? []} />;
  else if (mode === "channel" && current)
    main = (
      <div className="chat-main">
        <ChatThread key={current.chatId} id={current.chatId} channel={current} agents={agents?.agents ?? []} />
      </div>
    );
  else if (mode === "channel" && data) main = <EmptyState icon="forum">channel not found</EmptyState>;
  else if (mode === "channel") main = <EmptyState>loading…</EmptyState>;
  else if (!data || latest) main = <EmptyState>loading…</EmptyState>;
  else main = <ChannelsHome />;

  return (
    <div className="runs-screen channels-screen">
      <aside className="runs-side">
        <SideHead
          title="channels"
          action={
            <Button size="sm" variant="quiet" icon="add" href="/channels/new">
              new
            </Button>
          }
        />
        <SideList>
          {channels.map((c) => (
            <ListRow
              key={c.slug}
              href={`/channels/${encodeURIComponent(c.slug)}`}
              active={c.slug === slug}
              size="sm"
              leading={
                <Dot
                  tone={c.awaitingApproval ? "bad" : c.busy ? "working" : "idle"}
                  title={c.awaitingApproval ? "waiting for your approval" : c.busy ? "an agent is working" : undefined}
                />
              }
              title={`#${c.slug}`}
              sub={`${c.name}${c.project ? ` · 📁 ${c.project}` : ""}${c.members.length ? ` · ${c.members.map((m) => `@${m}`).join(" ")}` : ""}`}
              meta={fmtWhen(c.updatedAt)}
            />
          ))}
          {data && channels.length === 0 && (
            <SideNote>no channels yet — create one, or add a coworker to an agent session or a project chat</SideNote>
          )}
        </SideList>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}

/** No channels yet: nothing to explain, one thing to do. */
function ChannelsHome() {
  return (
    <EmptyState
      className="m-auto"
      action={
        <Button variant="primary" icon="add" href="/channels/new">
          new channel
        </Button>
      }
    >
      {null}
    </EmptyState>
  );
}

/** Agents to pick, one labelled checkbox row each (the label is what a test or a screen reader finds). */
function AgentChecks({ agents, checked, onToggle, none }: { agents: Agent[]; checked: string[]; onToggle: (slug: string, on: boolean) => void; none: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-control border border-line p-1">
      {agents.map((a) => (
        <Checkbox
          key={a.slug}
          checked={checked.includes(a.slug)}
          onChange={(on) => onToggle(a.slug, on)}
          hint={`@${a.slug}${a.description ? ` · ${a.description}` : ""}`}
          className={cn("rounded-control px-2.5 py-1.5 transition-colors hover:bg-surface-2", checked.includes(a.slug) && "bg-surface-2")}
        >
          <b className="font-semibold">
            {a.emoji} {a.name}
          </b>
        </Checkbox>
      ))}
      {agents.length === 0 && <EmptyState className="py-4">{none}</EmptyState>}
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
      const body = { name, purpose, members, responder: responder || null };
      const r = channel ? await api.request("channels.save", { slug: channel.slug, body }) : await api.request("channels.create", { body });
      const d = (r.data ?? {}) as ChannelView & { error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      navigate(`/channels/${encodeURIComponent(d.slug)}`);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  async function remove(): Promise<void> {
    if (!channel) return;
    if (!window.confirm(`Move #${channel.slug} and its transcript to the trash?`)) return;
    await api.request("channels.delete", { slug: channel.slug }).catch(() => {});
    navigate("/channels");
  }

  return (
    <Page width="narrow">
      <Panel
        title={channel ? `edit #${channel.slug}` : "new channel"}
        actions={
          channel && (
            <Button size="sm" variant="danger" icon="delete" onClick={() => void remove()}>
              delete
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4 p-[18px]">
          <Field label="name">
            <TextField value={name} placeholder="e.g. Website relaunch" onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="purpose — one line the agents read">
            <TextField value={purpose} placeholder="what this channel is for" onChange={(e) => setPurpose(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-fg">members — agents in this channel</span>
            <AgentChecks agents={active} checked={members} onToggle={toggle} none="no agents yet — create one on the agents screen first" />
          </div>
          <Field label="responder — answers when a message mentions nobody">
            <Select value={responder} onChange={(e) => setResponder(e.target.value)}>
              <option value="">nobody (agents only answer when @mentioned)</option>
              {members.map((m) => (
                <option key={m} value={m}>
                  @{m}
                </option>
              ))}
            </Select>
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex items-center gap-2">
            <Button variant="primary" busy={saving} disabled={!name.trim() || members.length === 0} onClick={() => void save()}>
              {saving ? "saving…" : channel ? "save" : "create channel"}
            </Button>
            <Button variant="quiet" href={channel ? `/channels/${encodeURIComponent(channel.slug)}` : "/channels"}>
              cancel
            </Button>
          </div>
        </div>
      </Panel>
    </Page>
  );
}

/**
 * "Add a coworker" from an agent session: the session becomes a channel
 * with this agent plus the ones picked here. From a project chat (no
 * agentSlug, a project instead): the picked agents form the channel, the
 * first one answers unmentioned messages, and the channel stays in the
 * project — every member reads its brief, state, records and links.
 * Everything said so far stays.
 */
export function AddCoworkerDialog({
  chatId,
  agentSlug,
  project,
  title,
  onClose,
  onCreated,
}: {
  chatId: string;
  agentSlug?: string;
  project?: string;
  title: string;
  onClose: () => void;
  /** Called with the new channel's slug instead of navigating to the channels screen (a project chat stays where it is). */
  onCreated?: (slug: string) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState(title || "");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .call("agents.list")
      .then((d) => setAgents(d.agents.filter((a) => !a.archived && a.slug !== agentSlug)))
      .catch(() => {});
  }, [agentSlug]);

  async function create(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await api.request("channels.fromChat", {
        body: {
          chatId,
          name,
          members: agentSlug ? [agentSlug, ...picked] : picked,
          responder: agentSlug ?? picked[0],
        },
      });
      const d = (r.data ?? {}) as { slug?: string; error?: string };
      if (!r.ok || !d.slug) throw new Error(d.error ?? `HTTP ${r.status}`);
      onClose();
      if (onCreated) onCreated(d.slug);
      else navigate(`/channels/${encodeURIComponent(d.slug)}`);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  return (
    <div
      className="fixed inset-0 z-40 grid animate-fade place-items-center bg-[color-mix(in_srgb,var(--text)_32%,transparent)] p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[calc(100dvh-48px)] w-[min(560px,100%)] animate-rise overflow-y-auto rounded-card border border-line bg-surface shadow-modal"
        role="dialog"
        aria-label="Add a coworker"
      >
        <div className="flex min-h-12 items-center gap-2 border-b border-line px-[18px] py-2">
          <Eyebrow className="text-fg">add a coworker</Eyebrow>
          <span className="flex-1" />
          <IconButton icon="close" label="close" size="sm" onClick={onClose} />
        </div>
        <div className="flex flex-col gap-4 p-[18px]">
          <p className="m-0 text-sm text-fg-2">
            {agentSlug ? (
              <>
                This session becomes a channel: @{agentSlug} stays and keeps its memory, the agents you pick join, and
                everyone reads the same transcript. @{agentSlug} answers when nobody is mentioned.
              </>
            ) : (
              <>
                This chat becomes a channel session of the project <b className="text-fg">{project}</b> and stays here: the agents you pick join with
                everything said so far and the project's brief, state, records and links. The first one you pick answers when
                nobody is mentioned.
              </>
            )}
          </p>
          <Field label="channel name">
            <TextField value={name} placeholder="e.g. Website relaunch" onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-fg">invite</span>
            <AgentChecks
              agents={agents}
              checked={picked}
              onToggle={(slug, on) => setPicked((p) => (on ? [...p, slug] : p.filter((x) => x !== slug)))}
              none="no other agents to invite yet"
            />
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex items-center gap-2">
            <Button variant="primary" busy={saving} disabled={!name.trim() || picked.length === 0} onClick={() => void create()}>
              {saving ? "creating…" : "create channel"}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
