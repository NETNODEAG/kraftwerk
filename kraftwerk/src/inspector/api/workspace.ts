import path from "node:path";
import { publicUrlFor, resolveProject } from "../../config.js";
import { disposeAllBackends } from "../chat/sessions.js";
import { cloudStatus } from "../cloud.js";
import { getProjectRoot } from "../context.js";
import { discoverWorkspaces, forgetWorkspace, listWorkspacesDetailed, startWorkspace, stopWorkspace, tildify } from "../instances.js";
import { searchAgents } from "../search.js";
import { getSettings, saveSettings, type SaveSettingsInput } from "../settings.js";
import { canSelfUpdate, startUpdate, updateStatus } from "../update.js";
import { getDiskVersion, getPkgName, getPkgVersion, RESTART_EXIT_CODE, supervised } from "../version.js";
import { disposeAllDevs } from "../vibeables.js";
import { fail, reply, route } from "./router.js";

/** The workspace itself: identity and features, settings, the other workspaces, updates. */
export const workspaceRoutes = [
  // ?probe=1 marks a discovery probe from another instance: answer identity
  // only, skip our own discovery (two instances must not probe each other
  // recursively).
  route({ name: "meta.get", method: "GET", path: "/api/meta", summary: "version, workspace identity, enabled features, the switcher" }, async (c) => {
    const project = await resolveProject(getProjectRoot()).catch(() => null);
    const projectName = project?.config.name ?? (project ? path.basename(project.root) : "");
    const manual = project?.config.switcher ?? [];
    const discovered = c.query.get("probe") === "1" ? [] : await discoverWorkspaces();
    // Manual switcher entries keep their configured name/icon; discovered
    // workspaces that duplicate one (same url, running) only contribute
    // the live flag. Stopped workspaces never collide — they carry a root,
    // and a manual entry pointing at the same port is just a link.
    const norm = (u: string) => u.replace(/\/+$/, "").replace("127.0.0.1", "localhost").toLowerCase();
    const manualUrls = new Set(manual.map((e) => norm(e.url)));
    const liveUrls = new Set(discovered.filter((d) => d.live).map((d) => norm(d.url)));
    const switcher = [
      ...manual.map((e) => (liveUrls.has(norm(e.url)) ? { ...e, live: true } : e)),
      ...discovered.filter((d) => !(d.live && manualUrls.has(norm(d.url)))),
    ];
    return {
      version: await getPkgVersion(),
      // A differing disk version means an upgrade landed while this process
      // runs — the UI offers a relaunch when a supervisor can respawn us.
      diskVersion: await getDiskVersion(),
      restartable: supervised(),
      projectName,
      projectIcon: project?.config.icon ?? "",
      projectColor: project?.config.color ?? "",
      projectNamed: !!project?.config.name,
      projectRoot: project?.root ?? getProjectRoot(),
      projectRootLabel: tildify(project?.root ?? getProjectRoot()),
      git: (project?.config.git && project.config.git.enabled !== false) === true,
      repos: (project?.config.repos && project.config.repos.enabled !== false) === true,
      vibeables: (project?.config.vibeables && project.config.vibeables.enabled !== false) === true,
      projects: (project?.config.projects && project.config.projects.enabled !== false) === true,
      publicUrl: (project && publicUrlFor(project)) ?? "",
      cloud: cloudStatus(),
      switcher,
    };
  }),

  route({ name: "settings.get", method: "GET", path: "/api/settings", summary: "kraftwerk.yml, parsed, with resolved paths" }, async () => getSettings()),
  route({ name: "settings.save", method: "PUT", path: "/api/settings", summary: "write the UI-editable subset of kraftwerk.yml", errors: 400 }, async (c) =>
    saveSettings(await c.body<SaveSettingsInput>()),
  ),

  route({ name: "workspaces.list", method: "GET", path: "/api/workspaces", summary: "every known workspace incl. this one, with state and counts" }, async () =>
    listWorkspacesDetailed(),
  ),
  // Launches `kraftwerk ui` for a known workspace as a detached process (the switcher's Start button).
  route({ name: "workspaces.start", method: "POST", path: "/api/workspaces/start", summary: "start a known workspace {root}", errors: 400 }, async (c) => {
    const { root } = await c.body<{ root?: string }>();
    if (!root) fail(400, "root required");
    const result = await startWorkspace(root);
    return reply(result.ok ? 200 : 409, result);
  }),
  route({ name: "workspaces.stop", method: "POST", path: "/api/workspaces/stop", summary: "stop a running workspace's server {root | url}", errors: 400 }, async (c) => {
    const target = await c.body<{ root?: string; url?: string }>();
    if (!target.root && !target.url) fail(400, "root or url required");
    const result = await stopWorkspace(target);
    return reply(result.ok ? 200 : 409, result);
  }),
  route({ name: "workspaces.forget", method: "POST", path: "/api/workspaces/forget", summary: "drop a workspace from the registry {root}", errors: 400 }, async (c) => {
    const { root } = await c.body<{ root?: string }>();
    if (!root) fail(400, "root required");
    return { ok: await forgetWorkspace(root) };
  }),

  route({ name: "search.agents", method: "GET", path: "/api/search/agents", summary: "active agents and channels of every reachable workspace (⌘K)" }, async () =>
    searchAgents(),
  ),

  route({ name: "update.check", method: "GET", path: "/api/update-check", summary: "the latest version on the npm registry" }, async () => {
    const name = await getPkgName();
    const current = await getDiskVersion();
    try {
      const r = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(String(r.status));
      const latest = ((await r.json()) as { version?: string }).version ?? "";
      return { name, current, latest } as { name: string; current: string; latest: string; error?: string };
    } catch {
      return reply(502, { name, current, latest: "", error: "npm registry unreachable" });
    }
  }),
  route({ name: "update.status", method: "GET", path: "/api/update", summary: "state and log of the self-update, and whether one can run here" }, async () => {
    const name = await getPkgName();
    const can = canSelfUpdate(name);
    return { ...updateStatus(), name, available: can.ok, reason: can.ok ? undefined : can.reason, restartable: supervised() };
  }),
  // Runs `npm i -g <name>@<version>`; 409 when refused or already running.
  route({ name: "update.start", method: "POST", path: "/api/update", summary: "self-update to {version?} (default latest)", errors: 409 }, async (c) => {
    const name = await getPkgName();
    const body = await c.body<{ version?: unknown }>();
    const version = typeof body.version === "string" && body.version ? body.version : "latest";
    return reply(202, { ...startUpdate(name, version), name });
  }),
  // Exits with the respawn code; the `kraftwerk ui` supervisor relaunches.
  route({ name: "server.restart", method: "POST", path: "/api/restart", summary: "relaunch the server (needs the `kraftwerk ui` supervisor)" }, async () => {
    if (!supervised()) fail(400, "not supervised — restart `kraftwerk ui` manually");
    setTimeout(() => {
      disposeAllBackends();
      disposeAllDevs();
      process.exit(RESTART_EXIT_CODE);
    }, 150);
    return { ok: true };
  }),
];
