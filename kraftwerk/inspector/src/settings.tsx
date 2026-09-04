import { useEffect, useState } from "react";
import { Icon } from "./shared";

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

export function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
  const [switcher, setSwitcher] = useState<SwitcherRow[]>([]);
  const [git, setGit] = useState<GitForm>(GIT_OFF);
  const [repos, setRepos] = useState<ReposForm>(REPOS_OFF);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: SettingsData) => {
        setData(d);
        setName(d.config.name ?? "");
        setIcon(d.config.icon ?? "");
        setColor(d.config.color ?? "");
        setSwitcher(d.config.switcher ?? []);
        setGit(gitForm(d));
        setRepos(reposForm(d));
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
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          icon,
          color,
          switcher,
          git: { ...git, interval: git.interval === "" ? undefined : Number(git.interval) },
          repos,
        }),
      });
      const d = (await r.json()) as SettingsData & { error?: string };
      if (!r.ok) throw new Error(d.error || "save failed");
      setData(d);
      setSwitcher(d.config.switcher ?? []);
      setGit(gitForm(d));
      setRepos(reposForm(d));
      setDirty(false);
      setSaved(true);
      // Nudge the app shell to refetch /api/meta so header + favicon update now.
      window.dispatchEvent(new Event("kw-meta-refresh"));
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

  if (!data) return <div className="empty">{error || "loading…"}</div>;

  const paths: [string, string | undefined, string][] = [
    ["port", String(data.resolved.port), "kraftwerk ui listens here (CLI --port wins)"],
    ["workflows", data.resolved.workflowsRoot ?? "— none found", "workflow definitions"],
    ["output", data.resolved.outputDir, "run artifacts"],
    ["knowledge", data.config.knowledge ?? "knowledge", "OKF knowledge bundles"],
    ["agents", data.config.agents ?? "agents", "agent definitions"],
    ["skills", data.config.skills ?? "skills", "workspace skills"],
  ];

  return (
    <div className="settings-screen">
      <div className="settings-head">
        <h1><Icon name="settings" className="ms-lg" /> Settings</h1>
        <span className="spacer" />
        {error && <span className="settings-err">{error}</span>}
        {saved && !dirty && <span className="settings-saved"><Icon name="check" className="ms-sm" /> saved</span>}
        <button className="run-btn" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? "saving…" : "save changes"}
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">workspace</span>
        </div>
        <div className="agent-form">
          <div className="agent-form-row">
            <label className="agent-field" style={{ width: 90 }}>
              icon
              <input
                value={icon}
                placeholder="🤖"
                onChange={(e) => {
                  setIcon(e.target.value);
                  touch();
                }}
              />
            </label>
            <label className="agent-field" style={{ flex: 1 }}>
              name
              <input
                value={name}
                placeholder="my workspace"
                onChange={(e) => {
                  setName(e.target.value);
                  touch();
                }}
              />
            </label>
            <label className="agent-field settings-color" style={{ width: 130 }} title="Accent in the workspace switcher; empty = derived from the folder">
              color
              <span className="settings-color-row">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888"}
                  onChange={(e) => {
                    setColor(e.target.value);
                    touch();
                  }}
                />
                <input
                  value={color}
                  placeholder="auto"
                  onChange={(e) => {
                    setColor(e.target.value);
                    touch();
                  }}
                />
              </span>
            </label>
          </div>
          <div className="settings-note">Shown in the header, browser tab and to other workspaces discovering this one.</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">workspace switcher</span>
          <span className="spacer" />
          <button
            className="run-btn tonal"
            onClick={() => {
              setSwitcher((rows) => [...rows, { name: "", url: "http://localhost:" }]);
              touch();
            }}
          >
            <Icon name="add" className="ms-sm" /> add entry
          </button>
        </div>
        <div className="agent-form">
          {switcher.length === 0 && <div className="settings-note">No manual entries.</div>}
          {switcher.map((row, i) => (
            <div className="agent-form-row" key={i}>
              <label className="agent-field" style={{ width: 70 }}>
                icon
                <input value={row.icon ?? ""} placeholder="•" onChange={(e) => setRow(i, { icon: e.target.value })} />
              </label>
              <label className="agent-field" style={{ flex: 1 }}>
                name
                <input value={row.name} placeholder="other workspace" onChange={(e) => setRow(i, { name: e.target.value })} />
              </label>
              <label className="agent-field" style={{ flex: 1.4 }}>
                url
                <input value={row.url} placeholder="http://localhost:1982" onChange={(e) => setRow(i, { url: e.target.value })} />
              </label>
              <button
                className="row-x settings-row-x"
                title="remove entry"
                onClick={() => {
                  setSwitcher((rows) => rows.filter((_, j) => j !== i));
                  touch();
                }}
              >
                <Icon name="close" className="ms-sm" />
              </button>
            </div>
          ))}
          <div className="settings-note">
            Running workspaces on this machine are discovered automatically — manual entries are for
            remote instances or extra links.
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">git sync</span>
          <span className="spacer" />
          <a className="run-btn tonal" href="#/git">
            <Icon name="account_tree" className="ms-sm" /> open git
          </a>
        </div>
        <div className="agent-form">
          <label className="settings-check">
            <input type="checkbox" checked={git.enabled} onChange={(e) => setGitField({ enabled: e.target.checked })} />
            sync workflows, knowledge, agents and skills with a git remote
          </label>
          {git.enabled && (
            <>
              <div className="agent-form-row">
                <label className="agent-field" style={{ flex: 1 }}>
                  remote
                  <input value={git.remote} placeholder="origin" onChange={(e) => setGitField({ remote: e.target.value })} />
                </label>
                <label className="agent-field" style={{ flex: 1 }}>
                  branch
                  <input value={git.branch} placeholder="checked-out branch" onChange={(e) => setGitField({ branch: e.target.value })} />
                </label>
                <label className="agent-field" style={{ width: 120 }}>
                  interval (s)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={git.interval}
                    placeholder="300"
                    onChange={(e) => setGitField({ interval: e.target.value })}
                  />
                </label>
                <label className="agent-field" style={{ width: 150 }}>
                  autosync
                  <select value={git.autosync} onChange={(e) => setGitField({ autosync: e.target.value as "off" | "pull" })}>
                    <option value="pull">fetch and pull</option>
                    <option value="off">fetch only</option>
                  </select>
                </label>
              </div>
              <div className="settings-note">
                The interval fetches in the background (0 turns the timer off); with autosync on it also fast-forwards
                when behind and nothing is modified locally. Commit and push stay manual on the git screen.
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">repositories</span>
          <span className="spacer" />
          <a className="run-btn tonal" href="#/repos">
            <Icon name="source" className="ms-sm" /> open repositories
          </a>
        </div>
        <div className="agent-form">
          <label className="settings-check">
            <input type="checkbox" checked={repos.enabled} onChange={(e) => setReposField({ enabled: e.target.checked })} />
            keep git repositories the agents work on under one folder
          </label>
          {repos.enabled && (
            <>
              <div className="agent-form-row">
                <label className="agent-field" style={{ flex: 1 }}>
                  repos root
                  <input value={repos.root} placeholder="repos" onChange={(e) => setReposField({ root: e.target.value })} />
                </label>
              </div>
              <div className="settings-note">
                Relative to the project root. Saving creates the folder and adds it to .gitignore; every agent gets the
                list of clones as context and can add more with <code>kraftwerk repos add</code>.
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">paths &amp; port</span>
          <span className="spacer" />
          <code className="settings-file" title={data.configPath}>
            {data.exists ? data.configPath : `${data.configPath} (not created yet)`}
          </code>
        </div>
        <div className="settings-kv-list">
          {paths.map(([key, value, hint]) => (
            <div className="settings-kv" key={key}>
              <span className="microlabel">{key}</span>
              <code>{value}</code>
              <span className="settings-kv-hint">{hint}</span>
            </div>
          ))}
        </div>
        <div className="settings-note" style={{ padding: "0 18px 14px" }}>
          Read-only here — edit <code>kraftwerk.yml</code> directly to change these.
        </div>
      </section>
    </div>
  );
}
