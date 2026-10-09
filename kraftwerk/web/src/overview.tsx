import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, failure, useApi } from "./api";
import { Icon, fmtAgo } from "./shared";
import { Button, ListRow, Notice, Section, TextField } from "./ui";
import { attentionFor, openAttention, useAttention } from "./attention";
import { filesHref } from "./files";
import { statusLine } from "../../src/core/status-line";
import type { Agent, AgentDetail, AgentStatus, AttentionItem, ChannelView, ProjectDetail } from "./types";

/**
 * The context column's first tab: the place at a glance, in plain words.
 * What a project is for and what happened lately, what waits for you
 * there, who works on it and where it stands; for an agent its role, what it is
 * doing, its schedule and its journal; for a channel who is in it; on Home
 * and with Ralv the workspace's projects and agents. Everything that had a
 * tab of its own (state, log, journal, agents, records) is a section here.
 */

export type OverviewOf =
  | { kind: "project"; project: ProjectDetail }
  | { kind: "agent"; agent: AgentDetail; journal: string }
  | { kind: "channel"; channel: ChannelView }
  | { kind: "workspace" };

/** Markdown for reading: a leading "# Title" is the section's own heading here, and "human:user" is you. */
const plain = (text: string): string => text.replace(/^# .*\n+/, "").replace(/\(human:user\)/g, "(you)");
// The overview's own pieces, so its sections read the same in every place.
const OV = "flex flex-col gap-1.5 px-1.5 pb-6 pt-3";
const GOAL = "m-0 px-2.5 pb-0.5 text-md leading-[1.45] text-fg";
const DIM = "m-0 px-2.5 py-0.5 text-sm text-fg-2";
const MD = "md-body px-2.5 text-sm leading-normal";
const md = (text: string): string => DOMPurify.sanitize(marked.parse(plain(text), { async: false }) as string);

/** "## 2026-10-05\n* line" -> the newest `n` entries with their day. */
function recentEntries(log: string, n: number): { day: string; text: string }[] {
  const out: { day: string; text: string }[] = [];
  let day = "";
  for (const line of log.split("\n")) {
    const h = /^## (.+)$/.exec(line.trim());
    if (h) day = h[1];
    else if (/^[-*] /.test(line)) out.push({ day, text: line.replace(/^[-*] /, "") });
    if (out.length >= n) break;
  }
  return out;
}

/** What waits for you here, oldest first; opening one goes to it with "next"'s focus. */
function NeedsYou({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Section size="lg" title="needs you" count={items.length}>
      {items.map((i) => (
        <ListRow
          key={i.id}
          onClick={() => openAttention(i)}
          leading={<Icon name={i.kind === "approval" ? "front_hand" : i.kind === "question" ? "help" : "error"} className="ms-sm text-bad" />}
          title={i.title}
          sub={`${i.owner.agent ? `${i.owner.agent.emoji ?? ""} ${i.owner.agent.name} · ` : ""}${i.kind === "approval" ? "needs approval" : i.kind === "question" ? "asks you" : "failed"} · ${fmtAgo(i.since)}`}
        />
      ))}
    </Section>
  );
}

/** Agents with the line under their name (what they are doing now). */
function Team({ slugs, agents, status, title = "team" }: { slugs: string[]; agents: Agent[]; status?: Record<string, AgentStatus>; title?: string }) {
  const team = slugs.map((s) => agents.find((a) => a.slug === s)).filter((a): a is Agent => !!a);
  if (team.length === 0) return null;
  return (
    <Section size="lg" title={title}>
      {team.map((a) => {
        const line = statusLine(status?.[a.slug], a.description);
        return (
          <ListRow
            key={a.slug}
            href={`/agents/${encodeURIComponent(a.slug)}`}
            leading={<span aria-hidden>{a.emoji || "🤖"}</span>}
            title={a.name}
            sub={line?.text}
            subTone={line?.tone === "waiting" ? "bad" : line?.tone === "working" ? "accent" : "plain"}
          />
        );
      })}
    </Section>
  );
}

function RecentFiles({ scope }: { scope: string }) {
  const data = useApi("files.recent", { query: { scope } }, { interval: 20_000 });
  if (!data || data.count === 0) return null;
  return (
    <Section size="lg" title="files" count={data.count} action={<Button variant="quiet" size="sm" href={filesHref(scope)}>all <Icon name="arrow_forward" className="ms-sm" /></Button>}>
      {data.recent.map((f) => {
        const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
        return (
          <ListRow
            key={f.path}
            href={filesHref(scope, dir, f.path)}
            leading={<Icon name="draft" className="ms-sm" />}
            title={f.path.split("/").pop()}
            sub={`${dir ? `${dir}/ · ` : ""}${fmtAgo(f.at)}`}
          />
        );
      })}
    </Section>
  );
}

export function Overview({ of }: { of: OverviewOf }) {
  const waiting = useAttention() ?? [];
  const agents = useApi("agents.list", {}, { interval: 15_000 })?.agents ?? [];
  const status = useApi("agents.status", {}, { interval: 5000 }) ?? undefined;

  if (of.kind === "project") {
    const p = of.project;
    const team = p.links.agents.map((l) => l.slug);
    const log = recentEntries(p.log, 5);
    return (
      <div className={OV}>
        <Section size="lg" title="goal">
          <p className={GOAL}>{p.goal || <span className="text-fg-2">No goal written yet.</span>}{p.status !== "active" && <span className="text-fg-2"> · {p.status}</span>}</p>
        </Section>
        {log.length > 0 && (
          <Section size="lg" title="lately">
            {log.map((e, i) => (
              <div key={i} className="grid grid-cols-[74px_minmax(0,1fr)] gap-2 px-2.5 py-1 text-sm">
                <span className="pt-px text-xs tabular-nums text-fg-2">{e.day}</span>
                <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parseInline(plain(e.text), { async: false }) as string) }} />
              </div>
            ))}
          </Section>
        )}
        <NeedsYou items={attentionFor.project(waiting, p.slug, team)} />
        <Team slugs={team} agents={agents} status={status} />
        <Section size="lg" title="where it stands">
          {p.state.trim() ? <div className={MD} dangerouslySetInnerHTML={{ __html: md(p.state) }} /> : <p className={DIM}>Nothing recorded yet: the project's chat writes this down at the end of a session that changed something.</p>}
        </Section>
        <RecentFiles scope={`project:${p.slug}`} />
        {p.records.length > 0 && (
          <Section size="lg" title="systems of record">
            {p.records.map((r, i) => (
              <ListRow
                key={i}
                onClick={() => r.url && window.open(r.url, "_blank", "noopener")}
                leading={<Icon name="open_in_new" className="ms-sm" />}
                title={r.title || r.kind}
                sub={r.note}
              />
            ))}
          </Section>
        )}
      </div>
    );
  }

  if (of.kind === "agent") return <AgentOverview agent={of.agent} journal={of.journal} waiting={waiting} status={status} />;

  if (of.kind === "channel") {
    const c = of.channel;
    return (
      <div className={OV}>
        <p className={GOAL}>{c.purpose || <span className="text-fg-2">A group chat with {c.members.length} agent{c.members.length === 1 ? "" : "s"}.</span>}</p>
        <NeedsYou items={attentionFor.channel(waiting, c.slug)} />
        <Team slugs={c.members} agents={agents} status={status} title="in this channel" />
      </div>
    );
  }

  return <WorkspaceOverview waiting={waiting} agents={agents} status={status} />;
}

function AgentOverview({ agent: a, journal, waiting, status }: { agent: AgentDetail; journal: string; waiting: AttentionItem[]; status?: Record<string, AgentStatus> }) {
  const projects = useApi("projects.list", {}, { interval: 30_000 })?.projects ?? [];
  const routines = useApi("agents.routines", { slug: a.slug }, { interval: 30_000 })?.routines ?? [];
  const [text, setText] = useState(journal);
  useEffect(() => setText(journal), [journal]);
  const line = statusLine(status?.[a.slug], a.description);
  const mine = projects.filter((p) => p.agents.includes(a.slug));
  return (
    <div className={OV}>
      <p className={GOAL}>{a.description || <span className="text-fg-2">No description yet.</span>}</p>
      {line && line.text !== a.description && <p className={`m-0 px-2.5 text-sm ${line.tone === "waiting" ? "text-bad" : line.tone === "working" ? "text-accent" : "text-fg-2"}`}>{line.text}</p>}
      <NeedsYou items={attentionFor.agent(waiting, a.slug)} />
      {mine.length > 0 && (
        <Section size="lg" title="works on">
          {mine.map((p) => (
            <ListRow key={p.slug} href={`/projects/${encodeURIComponent(p.slug)}`} leading={<span aria-hidden>📁</span>} title={p.title} sub={p.goal || undefined} />
          ))}
        </Section>
      )}
      {routines.length > 0 && (
        <Section size="lg" title="schedule">
          {routines.map((r) => (
            <ListRow
              key={r.id}
              leading={<Icon name="schedule" className="ms-sm" />}
              title={r.name}
              sub={`${!r.enabled ? "paused" : r.nextRunAt ? `next ${new Date(r.nextRunAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : r.schedule}${r.lastRunAt ? ` · last ${fmtAgo(r.lastRunAt)}` : ""}`}
            />
          ))}
        </Section>
      )}
      <Section size="lg" title="journal">
        <JournalNote slug={a.slug} onAdded={setText} />
        <div className={MD} dangerouslySetInnerHTML={{ __html: md(plain(text) || "_Nothing yet: the agent notes what it learns, decides and promises here, and reads it back at the start of every session._") }} />
      </Section>
    </div>
  );
}

function WorkspaceOverview({ waiting, agents, status }: { waiting: AttentionItem[]; agents: Agent[]; status?: Record<string, AgentStatus> }) {
  const projects = useApi("projects.list", {}, { interval: 30_000 });
  const active = (projects?.projects ?? []).filter((p) => p.status === "active");
  return (
    <div className={OV}>
      <NeedsYou items={waiting} />
      {projects?.enabled && (
        <Section size="lg" title="projects" count={active.length}>
          {active.length === 0 && <p className={DIM}>No active projects.</p>}
          {active.map((p) => {
            const n = attentionFor.project(waiting, p.slug, p.agents).length;
            return (
              <ListRow
                key={p.slug}
                href={`/projects/${encodeURIComponent(p.slug)}`}
                leading={<span aria-hidden>📁</span>}
                title={p.title}
                sub={n ? `${n} waiting for you` : p.goal || "no goal yet"}
                subTone={n ? "bad" : "plain"}
              />
            );
          })}
        </Section>
      )}
      <Team slugs={agents.filter((a) => !a.archived).map((a) => a.slug)} agents={agents} status={status} title="agents" />
      <RecentFiles scope="workspace" />
    </div>
  );
}

/** Tell the agent something it should remember: one line into its journal, signed as you. */
export function JournalNote({ slug, onAdded }: { slug: string; onAdded: (journal: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const d = await api
      .request("agents.addJournal", { slug, body: { entry: text, kind: "note" } })
      .then((r) => (r.ok ? { error: undefined, journal: r.data?.journal } : { error: failure(r), journal: undefined }))
      .catch((err: Error) => ({ error: err.message, journal: undefined }));
    setBusy(false);
    if (d.error || d.journal === undefined) return setError(d.error ?? "could not save");
    setText("");
    onAdded(d.journal);
  };
  return (
    <div className="px-2.5 pb-1.5 pt-0.5">
      <TextField
        className="h-8 text-sm"
        value={text}
        placeholder="add a note for the agent to remember"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add()}
        disabled={busy}
      />
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
