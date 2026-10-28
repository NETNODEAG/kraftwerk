import { DevicesPanel } from "./devices";
import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import { Icon } from "./shared";
import { Button, buttonClass, Checkbox, EmptyState, Eyebrow, Field, FieldRow, FormStack, Hint, IconButton, Notice, PageHeader, Panel, Select, Tag, TextField } from "./ui";

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
  autosync: "off" | "pull";
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
    git?: { enabled?: boolean; remote?: string; branch?: string; interval?: number; autosync?: "off" | "pull" };
    repos?: { enabled?: boolean; root?: string };
    vibeables?: { enabled?: boolean; root?: string };
    projects?: { enabled?: boolean; root?: string };
    contacts?: { enabled?: boolean; root?: string };
    places?: { enabled?: boolean; root?: string };
    events?: { enabled?: boolean; root?: string };
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
  contacts: { icon: "person", what: "keep people and organisations as contacts, referenced as contact:<slug> from projects, events and text", files: "one Markdown file per contact (frontmatter: role, org, email, phone, place, records; notes below)" },
  places: { icon: "location_on", what: "keep addresses and points of interest as places, referenced as place:<slug>; a Google Maps link derives from coordinates or the address", files: "one Markdown file per place (frontmatter: address, lat, lng, url, records; notes below)" },
  events: { icon: "event", what: "keep dated one-off entries as events with a place, contacts and a project, referenced as event:<slug>", files: "one Markdown file per event, named by its date (frontmatter: start, end, place, contacts, project, records; notes below)" },
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
function CloudPanel() {
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
          cloud <Tag tone={tone}>{word}</Tag>
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
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
  const [switcher, setSwitcher] = useState<SwitcherRow[]>([]);
  const [git, setGit] = useState<GitForm>(GIT_OFF);
  const [repos, setRepos] = useState<ReposForm>(REPOS_OFF);
  const [vibeables, setVibeables] = useState<ReposForm>(REPOS_OFF);
  const [projects, setProjects] = useState<ReposForm>(REPOS_OFF);
  const [entities, setEntities] = useState<EntityForms>(ENTITIES_OFF);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const identity = useApi("identity.get", {}, { interval: 60_000 });

  useEffect(() => {
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
        setEntities(entityForms(d));
      })
      .catch(() => setError("could not load settings"));
  }, []);

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

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <PageHeader
        icon={<Icon name="settings" className="text-[28px] text-fg-2" />}
        title="Settings"
        actions={
          <>
            {error && <Notice tone="bad">{error}</Notice>}
            {saved && !dirty && (
              <span className="inline-flex items-center gap-1 text-[12.5px] text-ok">
                <Icon name="check" className="ms-sm" /> saved
              </span>
            )}
            <Button variant="primary" busy={saving} disabled={!dirty} onClick={() => void save()}>
              {saving ? "saving…" : "save changes"}
            </Button>
          </>
        }
      />

      <Panel title="workspace">
        <FormStack>
          <FieldRow>
            <Field label="icon" className="w-[90px]">
              <TextField
                value={icon}
                placeholder="🤖"
                onChange={(e) => {
                  setIcon(e.target.value);
                  touch();
                }}
              />
            </Field>
            <Field label="name" className="min-w-40 flex-1">
              <TextField
                value={name}
                placeholder="my workspace"
                onChange={(e) => {
                  setName(e.target.value);
                  touch();
                }}
              />
            </Field>
            <label className="flex w-[130px] flex-col gap-1.5" title="Accent in the workspace switcher; empty = derived from the folder">
              <span className="text-sm font-semibold text-fg">color</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label="pick a color"
                  className="h-9 w-10 flex-none cursor-pointer rounded-control border border-line bg-surface p-0.5"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888"}
                  onChange={(e) => {
                    setColor(e.target.value);
                    touch();
                  }}
                />
                <TextField
                  className="min-w-0 px-2"
                  value={color}
                  placeholder="auto"
                  onChange={(e) => {
                    setColor(e.target.value);
                    touch();
                  }}
                />
              </span>
            </label>
          </FieldRow>
          <Hint>Shown in the header, browser tab and to other workspaces discovering this one.</Hint>
        </FormStack>
      </Panel>

      <Panel
        title="workspace switcher"
        actions={
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
        }
      >
        <FormStack>
          {switcher.length === 0 && <Hint>No manual entries.</Hint>}
          {switcher.map((row, i) => (
            <FieldRow key={i}>
              <Field label="icon" className="w-[70px]">
                <TextField value={row.icon ?? ""} placeholder="•" onChange={(e) => setRow(i, { icon: e.target.value })} />
              </Field>
              <Field label="name" className="min-w-32 flex-1">
                <TextField value={row.name} placeholder="other workspace" onChange={(e) => setRow(i, { name: e.target.value })} />
              </Field>
              <Field label="url" className="min-w-40 flex-[1.4]">
                <TextField value={row.url} placeholder="http://localhost:1982" onChange={(e) => setRow(i, { url: e.target.value })} />
              </Field>
              <IconButton
                icon="close"
                label="remove entry"
                className="mb-0.5"
                onClick={() => {
                  setSwitcher((rows) => rows.filter((_, j) => j !== i));
                  touch();
                }}
              />
            </FieldRow>
          ))}
          <Hint>
            Running workspaces on this machine are discovered automatically — manual entries are for
            remote instances or extra links.
          </Hint>
        </FormStack>
      </Panel>

      <Panel title="git sync" actions={<Button size="sm" icon="account_tree" href="/git">open git</Button>}>
        <FormStack>
          <Checkbox checked={git.enabled} onChange={(on) => setGitField({ enabled: on })}>
            sync workflows, knowledge, agents and skills with a git remote
          </Checkbox>
          {git.enabled && (
            <>
              <FieldRow>
                <Field label="remote" className="min-w-32 flex-1">
                  <TextField value={git.remote} placeholder="origin" onChange={(e) => setGitField({ remote: e.target.value })} />
                </Field>
                <Field label="branch" className="min-w-32 flex-1">
                  <TextField value={git.branch} placeholder="checked-out branch" onChange={(e) => setGitField({ branch: e.target.value })} />
                </Field>
                <Field label="interval (s)" className="w-[120px]">
                  <TextField
                    type="number"
                    min={0}
                    step={1}
                    value={git.interval}
                    placeholder="300"
                    onChange={(e) => setGitField({ interval: e.target.value })}
                  />
                </Field>
                <Field label="autosync" className="w-[150px]">
                  <Select value={git.autosync} onChange={(e) => setGitField({ autosync: e.target.value as "off" | "pull" })}>
                    <option value="pull">fetch and pull</option>
                    <option value="off">fetch only</option>
                  </Select>
                </Field>
              </FieldRow>
              <Hint>
                The interval fetches in the background (0 turns the timer off); with autosync on it also fast-forwards
                when behind and nothing is modified locally. Commit and push stay manual on the git screen.
              </Hint>
            </>
          )}
        </FormStack>
      </Panel>

      <Panel title="repositories" actions={<Button size="sm" icon="source" href="/repos">open repositories</Button>}>
        <FormStack>
          <Checkbox checked={repos.enabled} onChange={(on) => setReposField({ enabled: on })}>
            keep git repositories the agents work on under one folder
          </Checkbox>
          {repos.enabled && (
            <>
              <Field label="repos root">
                <TextField value={repos.root} placeholder="repos" onChange={(e) => setReposField({ root: e.target.value })} />
              </Field>
              <Hint>
                Relative to the project root. Saving creates the folder and adds it to .gitignore; every agent gets the
                list of clones as context and can add more with <code>kraftwerk repos add</code>.
              </Hint>
            </>
          )}
        </FormStack>
      </Panel>

      <Panel title="apps (vibeables)" actions={<Button size="sm" icon="web" href="/vibeables">open apps</Button>}>
        <FormStack>
          <Checkbox checked={vibeables.enabled} onChange={(on) => setVibeablesField({ enabled: on })}>
            build small apps live in a chat, with a preview pane next to the thread
          </Checkbox>
          {vibeables.enabled && (
            <>
              <Field label="vibeables root">
                <TextField value={vibeables.root} placeholder="kraftwerk-data/vibeables" onChange={(e) => setVibeablesField({ root: e.target.value })} />
              </Field>
              <Hint>
                Relative to the project root, one folder per app. Part of the workspace: versioned with it on the git screen, not
                git-ignored. Every chat gets a <b>vibeable</b> button; the agent then works inside the app folder.
              </Hint>
            </>
          )}
        </FormStack>
      </Panel>

      <Panel title="projects" actions={<Button size="sm" icon="folder_special" href="/projects">open projects</Button>}>
        <FormStack>
          <Checkbox checked={projects.enabled} onChange={(on) => setProjectsField({ enabled: on })}>
            gather a goal, its brief, systems of record and links in one folder, and chat inside it
          </Checkbox>
          {projects.enabled && (
            <>
              <Field label="projects root">
                <TextField value={projects.root} placeholder="kraftwerk-data/projects" onChange={(e) => setProjectsField({ root: e.target.value })} />
              </Field>
              <Hint>
                Relative to the project root, one folder per project (project.yml, brief.md, state.md, log.md). Part of the workspace:
                versioned with it on the git screen. A chat opened in a project starts with all of it as context.
              </Hint>
            </>
          )}
        </FormStack>
      </Panel>

      {ENTITY_KINDS.map((kind) => (
        <Panel key={kind} title={kind} actions={<Button size="sm" icon={ENTITY_COPY[kind].icon} href={`/${kind}`}>open {kind}</Button>}>
          <FormStack>
            <Checkbox checked={entities[kind].enabled} onChange={(on) => setEntityField(kind, { enabled: on })}>
              {ENTITY_COPY[kind].what}
            </Checkbox>
            {entities[kind].enabled && (
              <>
                <Field label={`${kind} root`}>
                  <TextField value={entities[kind].root} placeholder={`kraftwerk-data/${kind}`} onChange={(e) => setEntityField(kind, { root: e.target.value })} />
                </Field>
                <Hint>
                  Relative to the project root, {ENTITY_COPY[kind].files}. Part of the workspace: versioned with it on the git screen. Agents read and
                  write them with <code>kraftwerk {kind}</code>.
                </Hint>
              </>
            )}
          </FormStack>
        </Panel>
      ))}

      <CloudPanel />
      <DevicesPanel />

      <Panel
        title="paths & port"
        actions={
          <code className="max-w-[60%] truncate text-2xs text-fg-2" title={data.configPath}>
            {data.exists ? data.configPath : `${data.configPath} (not created yet)`}
          </code>
        }
      >
        <div className="flex flex-col pt-1.5 pb-2.5">
          {paths.map(([key, value, hint]) => (
            <div key={key} className="grid grid-cols-[110px_1fr] items-baseline gap-x-3.5 gap-y-px border-line/55 px-[18px] py-2 [&+&]:border-t">
              <Eyebrow>{key}</Eyebrow>
              <code className="text-xs break-all">{value}</code>
              <span className="col-start-2 text-2xs text-fg-2">{hint}</span>
            </div>
          ))}
        </div>
        <Hint className="px-[18px] pb-3.5">
          Read-only here — edit <code>kraftwerk.yml</code> directly to change these.
        </Hint>
      </Panel>
    </div>
  );
}
