import { CloudModePanel } from "./cloud-mode";
import { DevicesPanel } from "./devices";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GitRemoteSummary } from "./git";
import { api, useApi } from "./api";
import { Icon } from "./shared";
import { Button, buttonClass, EmptyState, FormStack, Hint, IconButton, Notice, PageHeader, Panel, Select, Tag, TextField } from "./ui";

/**
 * Workspace settings (#/settings): edits the UI-manageable subset of
 * kraftwerk.yml (name, icon, switcher, git) — the server rewrites the file
 * comment-preservingly. Everything else (paths, port) is shown read-only
 * with a pointer to the file.
 */

interface SwitcherRow {
  name: string;
  url: string;
  icon?: string;
}

interface GitForm {
  enabled: boolean;
  remote: string;
  branch: string;
  interval: string;
  autosync: "off" | "pull" | "push" | "sync";
}

const GIT_OFF: GitForm = { enabled: false, remote: "origin", branch: "", interval: "300", autosync: "pull" };

interface SettingsData {
  root: string;
  configPath: string;
  exists: boolean;
  config: {
    name?: string;
    icon?: string;
    color?: string;
    port?: number;
    workflows?: string;
    output?: string;
    knowledge?: string;
    agents?: string;
    skills?: string;
    switcher?: SwitcherRow[];
    git?: { enabled?: boolean; remote?: string; branch?: string; interval?: number; autosync?: "off" | "pull" | "push" | "sync" };
    repos?: { enabled?: boolean; root?: string };
    vibeables?: { enabled?: boolean; root?: string };
    projects?: { enabled?: boolean; root?: string };
    contacts?: { enabled?: boolean; root?: string };
    places?: { enabled?: boolean; root?: string };
    events?: { enabled?: boolean; root?: string };
    boards?: { enabled?: boolean; root?: string };
    presentations?: { enabled?: boolean; root?: string };
  };
  resolved: { workflowsRoot: string | null; outputDir: string; port: number };
}

/** The git block as form state; a missing block is "off" with defaults filled in. */
function gitForm(d: SettingsData): GitForm {
  const g = d.config.git;
  if (!g) return GIT_OFF;
  return {
    enabled: g.enabled !== false,
    remote: g.remote ?? GIT_OFF.remote,
    branch: g.branch ?? "",
    interval: String(g.interval ?? GIT_OFF.interval),
    autosync: g.autosync ?? GIT_OFF.autosync,
  };
}

interface ReposForm {
  enabled: boolean;
  root: string;
}
const REPOS_OFF: ReposForm = { enabled: false, root: "" };

/** The repos block as form state; a missing block is "off". */
function reposForm(d: SettingsData): ReposForm {
  const r = d.config.repos;
  if (!r) return REPOS_OFF;
  return { enabled: r.enabled !== false, root: r.root ?? "" };
}

/** The vibeables block, same shape. */
function vibeablesForm(d: SettingsData): ReposForm {
  const v = d.config.vibeables;
  if (!v) return REPOS_OFF;
  return { enabled: v.enabled !== false, root: v.root ?? "" };
}

/** The projects block, same shape. */
function projectsForm(d: SettingsData): ReposForm {
  const p = d.config.projects;
  if (!p) return REPOS_OFF;
  return { enabled: p.enabled !== false, root: p.root ?? "" };
}

/** The boards block, same shape. */
function boardsForm(d: SettingsData): ReposForm {
  const b = d.config.boards;
  if (!b) return REPOS_OFF;
  return { enabled: b.enabled !== false, root: b.root ?? "" };
}

/** The presentations block, same shape. */
function presentationsForm(d: SettingsData): ReposForm {
  const b = d.config.presentations;
  if (!b) return REPOS_OFF;
  return { enabled: b.enabled !== false, root: b.root ?? "" };
}

/** The contacts, places and events blocks: the same shape, one form each. */
type EntityKind = "contacts" | "places" | "events";
const ENTITY_KINDS: EntityKind[] = ["contacts", "places", "events"];
type EntityForms = Record<EntityKind, ReposForm>;
const ENTITIES_OFF: EntityForms = { contacts: REPOS_OFF, places: REPOS_OFF, events: REPOS_OFF };
function entityForms(d: SettingsData): EntityForms {
  const one = (kind: EntityKind): ReposForm => {
    const e = d.config[kind];
    if (!e) return REPOS_OFF;
    return { enabled: e.enabled !== false, root: e.root ?? "" };
  };
  return { contacts: one("contacts"), places: one("places"), events: one("events") };
}
const ENTITY_COPY: Record<EntityKind, { icon: string; what: string; files: string }> = {
  contacts: { icon: "person", what: "keep people and organisations as contacts, referenced as contact:<slug>", files: "one Markdown file per contact (frontmatter: role, org, email, phone, place, records; notes below)" },
  places: { icon: "location_on", what: "keep addresses and points of interest as places, referenced as place:<slug>", files: "one Markdown file per place (frontmatter: address, lat, lng, url, records; notes below); a Google Maps link derives from coordinates or the address" },
  events: { icon: "event", what: "keep dated one-off entries as events, referenced as event:<slug>", files: "one Markdown file per event, named by its date (frontmatter: start, end, place, contacts, project, records; notes below)" },
};

interface CloudMeta {
  url: string;
  state: "off" | "connecting" | "connected" | "error";
  /** Why it is off, when it is (cloud.json, KRAFTWERK_CLOUD_URL=off, a server that is not the daemon). */
  reason?: string;
  error?: string;
  /** The machine's id in the cloud. */
  id?: string;
  /** This machine's handle@machine. */
  machine?: string;
  /** false: this workspace is left out (cloud.enabled: false in kraftwerk.yml). */
  included?: boolean;
  account?: string | null;
  interval?: number;
  lastSeen?: string;
  claimCode?: string | null;
  claimUrl?: string | null;
}

/**
 * The cloud panel: the daemon registers this MACHINE with the kraftwerk
 * cloud, its open workspaces as children; here the user sees whether that
 * worked, whether this workspace is listed, and — until claimed — the code
 * (and link) that puts the machine under their account. Polled while the
 * screen is open, because the claim happens in the cloud and reaches the
 * daemon with the next heartbeat.
 */
export function CloudPanel() {
  const [cloud, setCloud] = useState<CloudMeta | null>(null);
  const [copied, setCopied] = useState(false);
  // While the claim page is open in another tab, sync every 2 s so the claim lands here in seconds, not a heartbeat.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .call("meta.get")
        .then((m) => alive && m.cloud && setCloud(m.cloud))
        .catch(() => {});
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!waiting) return;
    if (cloud?.account) return void setWaiting(false);
    const t = setInterval(() => {
      api
        .call("cloud.sync")
        .then((s) => {
          setCloud((c) => (c ? { ...c, ...s } : c));
          if ((s as CloudMeta).account) setWaiting(false);
        })
        .catch(() => {});
    }, 2_000);
    const stop = setTimeout(() => setWaiting(false), 600_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waiting, cloud?.account]);
  if (!cloud) return null;
  const word = cloud.state === "connected" ? (cloud.account ? "claimed" : "unclaimed") : cloud.state;
  const tone = cloud.state === "connected" && cloud.account ? "ok" : cloud.state === "error" ? "bad" : "neutral";
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          this machine in the cloud <Tag tone={tone}>{word}</Tag>
        </span>
      }
      actions={
        cloud.url && (
          <a className={buttonClass("secondary", "sm")} href={cloud.url} target="_blank" rel="noreferrer">
            <Icon name="cloud" className="ms-sm" /> open the cloud
          </a>
        )
      }
    >
      <FormStack>
        {cloud.state === "off" && (
          <Hint>
            Off — {cloud.reason ?? "turned off for this machine"}. The daemon registers the machine with the kraftwerk cloud, so its owner sees its
            workspaces running from anywhere; <code>kraftwerk cloud on</code> and <code>kraftwerk login</code> in a terminal turn it on and claim it.
          </Hint>
        )}
        {cloud.state === "connecting" && <Hint>Registering with {cloud.url} …</Hint>}
        {cloud.state === "error" && (
          <Hint>
            Could not reach {cloud.url}: {cloud.error}. Retrying every {cloud.interval ?? 60}s — the UI works as before meanwhile.
          </Hint>
        )}
        {cloud.state === "connected" && cloud.account && (
          <>
            <Hint>
              This machine{cloud.machine ? <> (<code>{cloud.machine}</code>)</> : null} is registered at <a href={cloud.url} target="_blank" rel="noreferrer">{cloud.url}</a> under <strong>{cloud.account}</strong>.
              Last heartbeat {cloud.lastSeen ? new Date(cloud.lastSeen).toLocaleTimeString() : "pending"}.
            </Hint>
            <div>
              <Button
                size="sm"
                variant="secondary"
                icon="logout"
                onClick={() => {
                  if (!confirm(`Sign this machine out of ${cloud.account}? It stays registered, unclaimed, and sends no folder paths until claimed again.`)) return;
                  void api
                    .call("cloud.unlink")
                    .then((s) => setCloud((c) => (c ? { ...c, ...s, account: null } : c)))
                    .catch(() => {});
                }}
              >
                sign out
              </Button>
            </div>
          </>
        )}
        {cloud.state === "connected" && !cloud.account && (
          <>
            <Hint>
              This machine is registered at <a href={cloud.url} target="_blank" rel="noreferrer">{cloud.url}</a>, not yet under an account (no folder
              paths are sent until it is). Sign in there and enter this code — or open the link, or run <code>kraftwerk login</code>:
            </Hint>
            <div className="flex flex-wrap items-center gap-2.5">
              <code className="rounded-control border border-line bg-surface-2 px-3 py-1.5 font-mono text-lg tracking-[0.12em] text-fg">{cloud.claimCode ?? "…"}</code>
              {cloud.claimCode && (
                <Button
                  size="sm"
                  icon="content_copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(cloud.claimCode!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "copied" : "copy"}
                </Button>
              )}
              {cloud.claimUrl && (
                <a className={buttonClass("primary", "sm")} href={cloud.claimUrl} target="_blank" rel="noreferrer" onClick={() => setWaiting(true)}>
                  <Icon name="link" className="ms-sm" /> sign in &amp; claim
                </a>
              )}
              {waiting && <span className="text-fg-dim text-sm">waiting for the claim …</span>}
            </div>
            <Hint>
              A claim made there reaches this machine with the next heartbeat (every {cloud.interval ?? 60}s). To keep this workspace out of the
              cloud, set <code>cloud.enabled: false</code> in kraftwerk.yml.
            </Hint>
          </>
        )}
        {cloud.state !== "off" && cloud.included === false && (
          <Hint>
            This workspace is left out of the machine's record: <code>cloud.enabled: false</code> in kraftwerk.yml.
          </Hint>
        )}
      </FormStack>
    </Panel>
  );
}

/** A panel's form body: fields stacked, a row of fields side by side. */

export function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  // Which kraftwerk serves this workspace — and the one on disk, when an update waits for a restart.
  const [running, setRunning] = useState<{ version: string; diskVersion?: string } | null>(null);
  useEffect(() => {
    api
      .call("meta.get")
      .then((d) => setRunning({ version: d.version, diskVersion: d.diskVersion }))
      .catch(() => {});
  }, []);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
  const [switcher, setSwitcher] = useState<SwitcherRow[]>([]);
  const [git, setGit] = useState<GitForm>(GIT_OFF);
  const [repos, setRepos] = useState<ReposForm>(REPOS_OFF);
  const [vibeables, setVibeables] = useState<ReposForm>(REPOS_OFF);
  const [projects, setProjects] = useState<ReposForm>(REPOS_OFF);
  const [boards, setBoards] = useState<ReposForm>(REPOS_OFF);
  const [decks, setDecks] = useState<ReposForm>(REPOS_OFF);
  const [entities, setEntities] = useState<EntityForms>(ENTITIES_OFF);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const identity = useApi("identity.get", {}, { interval: 60_000 });

  const load = useCallback(() => {
    api
      .call("settings.get")
      .then((d) => {
        setData(d);
        setName(d.config.name ?? "");
        setIcon(d.config.icon ?? "");
        setColor(d.config.color ?? "");
        setSwitcher(d.config.switcher ?? []);
        setGit(gitForm(d));
        setRepos(reposForm(d));
        setVibeables(vibeablesForm(d));
        setProjects(projectsForm(d));
        setBoards(boardsForm(d));
        setDecks(presentationsForm(d));
        setEntities(entityForms(d));
      })
      .catch(() => setError("could not load settings"));
  }, []);
  useEffect(() => load(), [load]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setError("");
  };

  async function save(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await api.request("settings.save", {
        body: {
          name,
          icon,
          color,
          switcher,
          git: { ...git, interval: git.interval === "" ? undefined : Number(git.interval) },
          repos,
          vibeables,
          projects,
          boards,
          presentations: decks,
          ...entities,
        },
      });
      if (!r.ok) throw new Error(r.error || "save failed");
      const d = r.data;
      setData(d);
      setSwitcher(d.config.switcher ?? []);
      setGit(gitForm(d));
      setRepos(reposForm(d));
      setVibeables(vibeablesForm(d));
      setProjects(projectsForm(d));
      setBoards(boardsForm(d));
      setDecks(presentationsForm(d));
      setEntities(entityForms(d));
      setDirty(false);
      setSaved(true);
      // Nudge the app shell to refetch /api/meta so header + favicon update now.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const setRow = (i: number, patch: Partial<SwitcherRow>): void => {
    setSwitcher((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    touch();
  };
  const setGitField = (patch: Partial<GitForm>): void => {
    setGit((g) => ({ ...g, ...patch }));
    touch();
  };
  const setReposField = (patch: Partial<ReposForm>): void => {
    setRepos((r) => ({ ...r, ...patch }));
    touch();
  };
  const setVibeablesField = (patch: Partial<ReposForm>): void => {
    setVibeables((v) => ({ ...v, ...patch }));
    touch();
  };
  const setProjectsField = (patch: Partial<ReposForm>): void => {
    setProjects((p) => ({ ...p, ...patch }));
    touch();
  };
  const setBoardsField = (patch: Partial<ReposForm>): void => {
    setBoards((b) => ({ ...b, ...patch }));
    touch();
  };
  const setDecksField = (patch: Partial<ReposForm>): void => {
    setDecks((b) => ({ ...b, ...patch }));
    touch();
  };
  const setEntityField = (kind: EntityKind, patch: Partial<ReposForm>): void => {
    setEntities((e) => ({ ...e, [kind]: { ...e[kind], ...patch } }));
    touch();
  };

  if (!data) return <EmptyState>{error || "loading…"}</EmptyState>;

  const paths: [string, string | undefined, string][] = [
    ["identity", identity?.identity ?? "…", "this machine — the runner routines name in runs_on (kraftwerk whoami to rename)"],
    ["port", String(data.resolved.port), "kraftwerk ui listens here (CLI --port wins)"],
    ["workflows", data.resolved.workflowsRoot ?? "— none found", "workflow definitions"],
    ["output", data.resolved.outputDir, "run artifacts"],
    ["knowledge", data.config.knowledge ?? "knowledge", "OKF knowledge bundles"],
    ["agents", data.config.agents ?? "agents", "agent definitions"],
    ["skills", data.config.skills ?? "skills", "workspace skills"],
  ];

  const features: Array<{ key: string; icon: string; title: string; what: string; files: string; href: string; form: ReposForm; set: (patch: Partial<ReposForm>) => void; placeholder: string }> = [
    { key: "repos", icon: "source", title: "Repositories", what: "keep git repositories the agents work on under one folder", files: "Saving creates the folder and adds it to .gitignore; every agent gets the list of clones as context and can add more with `kraftwerk repos add`.", href: "/repos", form: repos, set: setReposField, placeholder: "repos" },
    { key: "vibeables", icon: "web", title: "Apps", what: "build small apps live in a chat, with a preview pane next to the thread", files: "One folder per app, versioned with the workspace. Every chat gets a vibeable button; the agent then works inside the app folder.", href: "/vibeables", form: vibeables, set: setVibeablesField, placeholder: "kraftwerk-data/vibeables" },
    { key: "projects", icon: "folder_special", title: "Projects", what: "gather a goal, its brief and its links in one folder, and chat inside it", files: "One folder per project (project.yml, brief.md, state.md, log.md), versioned with the workspace. A chat opened in a project starts with all of it as context.", href: "/projects", form: projects, set: setProjectsField, placeholder: "kraftwerk-data/projects" },
    { key: "boards", icon: "view_kanban", title: "Boards", what: "keep the work as boards of tasks; an assigned agent wakes up", files: "One folder per workspace board; a project's boards live in projects/<slug>/boards/. Each task is a folder with task.md, log.md and its files. Agents use `kraftwerk tasks`.", href: "/boards", form: boards, set: setBoardsField, placeholder: "kraftwerk-data/boards" },
    { key: "presentations", icon: "slideshow", title: "Presentations", what: "make slide decks from markdown, presented and exported as PowerPoint or PDF", files: "One folder per deck (deck.md and its pictures), templates under templates/<slug>/template.yml; a project's decks live in projects/<slug>/presentations/. Agents use `kraftwerk presentations`.", href: "/presentations", form: decks, set: setDecksField, placeholder: "kraftwerk-data/presentations" },
    ...ENTITY_KINDS.map((kind) => ({
      key: kind,
      icon: ENTITY_COPY[kind].icon,
      title: kind[0].toUpperCase() + kind.slice(1),
      what: ENTITY_COPY[kind].what,
      files: `${ENTITY_COPY[kind].files[0].toUpperCase()}${ENTITY_COPY[kind].files.slice(1)}. Agents use \`kraftwerk ${kind}\`.`,
      href: `/${kind}`,
      form: entities[kind],
      set: (patch: Partial<ReposForm>) => setEntityField(kind, patch),
      placeholder: `kraftwerk-data/${kind}`,
    })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3">
      <PageHeader
        icon={<Icon name="settings" className="text-[24px] text-fg-2" />}
        title="Settings"
        sub={
          running && (
            <span className="settings-version font-mono text-xs" title="the kraftwerk version serving this workspace">
              kraftwerk {running.version}
              {running.diskVersion && running.diskVersion !== running.version ? ` · ${running.diskVersion} installed, runs after a restart` : ""}
            </span>
          )
        }
        actions={
          <>
            {error && <Notice tone="bad">{error}</Notice>}
            {saved && !dirty && (
              <span className="inline-flex items-center gap-1 text-[12.5px] text-ok">
                <Icon name="check" className="ms-sm" /> saved
              </span>
            )}
            <Button variant="primary" size="sm" busy={saving} disabled={!dirty} onClick={() => void save()}>
              {saving ? "saving…" : "save changes"}
            </Button>
          </>
        }
      />

      <Panel title="workspace">
        <SettingRow title="Name" sub="In the header, the browser tab and the workspace switcher.">
          <TextField
            aria-label="icon"
            className="h-8 w-12 flex-none px-0 text-center"
            value={icon}
            placeholder="🤖"
            onChange={(e) => {
              setIcon(e.target.value);
              touch();
            }}
          />
          <TextField
            aria-label="name"
            className="h-8 text-sm"
            value={name}
            placeholder="my workspace"
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
          />
        </SettingRow>
        <SettingRow title="Color" sub="Accent in the workspace switcher; empty derives one from the folder.">
          <input
            type="color"
            aria-label="pick a color"
            className="h-8 w-9 flex-none cursor-pointer rounded-control border border-line bg-surface p-0.5"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888"}
            onChange={(e) => {
              setColor(e.target.value);
              touch();
            }}
          />
          <TextField
            aria-label="color"
            className="h-8 w-28 font-mono text-xs"
            value={color}
            placeholder="auto"
            onChange={(e) => {
              setColor(e.target.value);
              touch();
            }}
          />
        </SettingRow>
        <SettingRow title="Switcher entries" sub="Workspaces running on this machine appear by themselves; add remote instances or extra links.">
          <Button
            size="sm"
            icon="add"
            onClick={() => {
              setSwitcher((rows) => [...rows, { name: "", url: "http://localhost:" }]);
              touch();
            }}
          >
            add entry
          </Button>
        </SettingRow>
        {switcher.map((row, i) => (
          <div key={i} className="flex items-center gap-2 border-t border-line/55 px-[18px] py-2">
            <TextField aria-label="entry icon" className="h-8 w-12 flex-none px-0 text-center" value={row.icon ?? ""} placeholder="•" onChange={(e) => setRow(i, { icon: e.target.value })} />
            <TextField aria-label="entry name" className="h-8 text-sm" value={row.name} placeholder="other workspace" onChange={(e) => setRow(i, { name: e.target.value })} />
            <TextField aria-label="entry url" className="h-8 font-mono text-xs" value={row.url} placeholder="http://localhost:1982" onChange={(e) => setRow(i, { url: e.target.value })} />
            <IconButton
              icon="close"
              label="remove entry"
              onClick={() => {
                setSwitcher((rows) => rows.filter((_, j) => j !== i));
                touch();
              }}
            />
          </div>
        ))}
      </Panel>

      <Panel title="git sync" actions={<Button size="sm" icon="account_tree" href="/git">open git</Button>}>
        <ToggleRow id="set-git" icon="sync" title="Sync with a git remote" what="sync workflows, knowledge, agents and skills with a git remote" checked={git.enabled} onChange={(on) => setGitField({ enabled: on })} />
        <GitRemoteSummary onSetup={load} />
        {git.enabled && (
          <>
            <SettingRow title="Remote" sub="The remote to fetch from and push to.">
              <TextField aria-label="remote" className="h-8 w-56 font-mono text-xs" value={git.remote} placeholder="origin" onChange={(e) => setGitField({ remote: e.target.value })} />
            </SettingRow>
            <SettingRow title="Branch" sub="Empty follows the checked-out branch.">
              <TextField aria-label="branch" className="h-8 w-56 font-mono text-xs" value={git.branch} placeholder="checked-out branch" onChange={(e) => setGitField({ branch: e.target.value })} />
            </SettingRow>
            <SettingRow title="Interval" sub="Seconds between background fetches; 0 turns the timer off.">
              <TextField aria-label="interval (s)" className="h-8 w-24 text-sm tabular-nums" type="number" min={0} step={1} value={git.interval} placeholder="300" onChange={(e) => setGitField({ interval: e.target.value })} />
            </SettingRow>
            <SettingRow title="Autosync" sub="Pull fast-forwards when behind and clean; push also pushes commits. Sync commits what changed as well, and where both sides changed a file the remote's version wins and this machine's is kept beside it (name.konflikt-<handle>.ext).">
              <Select aria-label="autosync" className="h-8 w-64 text-sm" value={git.autosync} onChange={(e) => setGitField({ autosync: e.target.value as "off" | "pull" | "push" | "sync" })}>
                <option value="pull">fetch and pull</option>
                <option value="push">fetch, pull and push</option>
                <option value="sync">sync: commit, pull and push</option>
                <option value="off">fetch only</option>
              </Select>
            </SettingRow>
          </>
        )}
      </Panel>

      <Panel title="features">
        {features.map((f) => (
          <ToggleRow key={f.key} id={`set-${f.key}`} icon={f.icon} title={f.title} what={f.what} checked={f.form.enabled} onChange={(on) => f.set({ enabled: on })}>
            {f.form.enabled && (
              <div className="flex items-center gap-2">
                <TextField
                  aria-label={`${f.key === "vibeables" ? "vibeables" : f.key} root`}
                  title={`Folder, relative to the workspace root. ${f.files}`}
                  className="h-7 w-[230px] font-mono text-xs max-[700px]:w-full"
                  value={f.form.root}
                  placeholder={f.placeholder}
                  onChange={(e) => f.set({ root: e.target.value })}
                />
                <IconButton icon="arrow_forward" label={`open ${f.title.toLowerCase()}`} href={f.href} />
              </div>
            )}
          </ToggleRow>
        ))}
      </Panel>

      <CloudModePanel />
      <DevicesPanel />

      <Panel
        title="paths & port"
        actions={
          <code className="max-w-[60%] truncate text-2xs text-fg-2" title={data.configPath}>
            {data.exists ? data.configPath : `${data.configPath} (not created yet)`}
          </code>
        }
      >
        <div className="flex flex-col py-1">
          {paths.map(([key, value, hint]) => (
            <div key={key} className="grid grid-cols-[100px_minmax(0,1fr)] items-baseline gap-x-3 px-[18px] py-1.5 min-[900px]:grid-cols-[100px_minmax(0,1fr)_minmax(0,0.9fr)]">
              <span className="text-xs font-semibold text-fg-2">{key}</span>
              <code className="truncate text-xs" title={value}>{value}</code>
              <span className="truncate text-2xs text-fg-2 max-[899px]:hidden" title={hint}>{hint}</span>
            </div>
          ))}
        </div>
        <Hint className="border-t border-line/55 px-[18px] py-2.5">
          Read-only here — edit <code>kraftwerk.yml</code> directly to change these.
        </Hint>
      </Panel>
    </div>
  );
}

/** One setting as a row: what it is on the left, its control on the right — stacked on a narrow screen. */
function SettingRow({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-[18px] py-2.5 [&+&]:border-t [&+&]:border-line/55 max-[700px]:flex-col max-[700px]:items-stretch max-[700px]:gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        {sub && <div className="text-xs leading-snug text-fg-2">{sub}</div>}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 min-[701px]:w-[46%]">{children}</div>
    </div>
  );
}

/**
 * A feature as a row: icon, name, what it does, and a switch — a real
 * checkbox (named by the row's text), drawn as a switch. What a turned-on
 * feature needs (its folder) goes under the text.
 */
function ToggleRow({ id, icon, title, what, checked, onChange, children }: { id: string; icon: string; title: string; what: string; checked: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-[18px] py-2 [&+&]:border-t [&+&]:border-line/55">
      <Icon name={icon} className={`flex-none text-[18px] ${checked ? "text-accent" : "text-fg-2"}`} />
      <label htmlFor={id} className="min-w-[200px] flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs leading-snug text-fg-2">{what}</span>
      </label>
      {children && <div className="flex-none max-[700px]:order-last max-[700px]:w-full max-[700px]:ps-[30px]">{children}</div>}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="relative h-5 w-9 flex-none cursor-pointer appearance-none rounded-full border border-line bg-surface-2 transition-colors before:absolute before:top-1/2 before:left-[3px] before:size-3.5 before:-translate-y-1/2 before:rounded-full before:bg-fg-2 before:transition-[left,background-color] checked:border-accent checked:bg-accent checked:before:left-[17px] checked:before:bg-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
    </div>
  );
}

