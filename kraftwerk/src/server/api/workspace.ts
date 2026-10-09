import path from "node:path";
import * as z from "zod";
import { absolutePath, resolveWorkspace, slugFromFolder, workspaceSlug } from "../../config.js";
import { disposeAllBackends } from "../../core/chat/sessions.js";
import { cloudStatus } from "../cloud.js";
import { workspaceRoot } from "../../core/context.js";
import { discoverWorkspaces, forgetWorkspace, listWorkspacesDetailed, startWorkspace, stopWorkspace, tildify, type StartResult, type WorkspaceEntry } from "../../core/instances.js";
import { currentHub } from "../hub-context.js";
import { searchAgents } from "../../core/search.js";
import { getSettings, saveSettings, type SaveSettingsInput } from "../../core/settings.js";
import { canSelfUpdate, startUpdate, updateStatus } from "../../core/update.js";
import { getDiskVersion, getPkgName, getPkgVersion, RESTART_EXIT_CODE, supervised } from "../version.js";
import { disposeAllDevs } from "../../core/vibeables.js";
import { fail, reply, route } from "./router.js";

/** A feature block with a folder (repos, vibeables, projects); saveSettings checks the root. Nested blocks are plain objects: saveSettings reads only these fields. */
const RootBlock = z.object({ enabled: z.boolean(), root: z.string().optional() });

/** The UI-editable subset of kraftwerk.yml. Loose: saveSettings validates values and writes what it knows. */
const SettingsFields = z.looseObject({
  name: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  switcher: z.array(z.object({ name: z.string(), url: z.string(), icon: z.string().optional() })).optional(),
  git: z
    .object({
      enabled: z.boolean(),
      remote: z.string().optional(),
      branch: z.string().optional(),
      interval: z.union([z.number(), z.string()]).optional(),
      autosync: z.string().optional(),
    })
    .optional(),
  repos: RootBlock.optional(),
  vibeables: RootBlock.optional(),
  projects: RootBlock.optional(),
});

/** A start's answer; `here` (with its slug) when the hub answering serves it now. */
type StartReply = StartResult & { slug?: string; here?: true };

/**
 * Mark the workspaces the hub answering this request serves — or, a daemon,
 * would serve once started (it opens a stopped one next to the others, at
 * <slug>.localhost:<its port>) — as `here`. The UI links those in the form
 * the page itself was reached by: a paired phone on the network cannot
 * resolve <slug>.localhost, so it gets /w/<slug>/ on the address it used.
 */
function placeInHub<T extends Pick<WorkspaceEntry, "url" | "root" | "slug" | "live" | "exists">>(entries: T[]): (T & { here?: true })[] {
  const hub = currentHub();
  const served = new Set(hub.list().map((o) => o.root));
  return entries.map((e) => {
    if (!e.root || !e.slug) return e;
    if (served.has(e.root)) return { ...e, here: true };
    if (hub.daemon && !e.live && e.exists !== false) return { ...e, here: true, url: `http://${e.slug}.localhost:${hub.port}` };
    return e;
  });
}

/** The workspace itself: identity and features, settings, the other workspaces, updates. */
export const workspaceRoutes = [
  // ?probe=1 marks a discovery probe from another instance: answer identity
  // only, skip our own discovery (two instances must not probe each other
  // recursively).
  route({ name: "meta.get", method: "GET", path: "/api/meta", summary: "version, workspace identity, enabled features, the switcher" }, async (c) => {
    const ws = await resolveWorkspace(workspaceRoot()).catch(() => null);
    const name = ws?.config.name ?? (ws ? path.basename(ws.root) : "");
    const root = ws?.root ?? workspaceRoot();
    const manual = ws?.config.switcher ?? [];
    const discovered = c.query.get("probe") === "1" ? [] : placeInHub(await discoverWorkspaces());
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
    const identity = {
      workspaceName: name,
      workspaceSlug: ws ? workspaceSlug(ws) : slugFromFolder(path.basename(root)),
      workspaceIcon: ws?.config.icon ?? "",
      workspaceColor: ws?.config.color ?? "",
      workspaceNamed: !!ws?.config.name,
      workspaceRoot: root,
      workspaceRootLabel: tildify(root),
    };
    return {
      version: await getPkgVersion(),
      // A differing disk version means an upgrade landed while this process
      // runs — the UI offers a relaunch when a supervisor can respawn us.
      diskVersion: await getDiskVersion(),
      restartable: supervised(),
      ...identity,
      /** @deprecated The pre-0.64 names of the workspace* fields; older instances probing this one read them. Removed with protocol 2. */
      projectName: identity.workspaceName,
      projectIcon: identity.workspaceIcon,
      projectColor: identity.workspaceColor,
      projectNamed: identity.workspaceNamed,
      projectRoot: identity.workspaceRoot,
      projectRootLabel: identity.workspaceRootLabel,
      git: (ws?.config.git && ws.config.git.enabled !== false) === true,
      repos: (ws?.config.repos && ws.config.repos.enabled !== false) === true,
      vibeables: (ws?.config.vibeables && ws.config.vibeables.enabled !== false) === true,
      projects: (ws?.config.projects && ws.config.projects.enabled !== false) === true,
      /** @deprecated Always "": the Cloudflare Tunnel that set it was removed in 0.65. Removed with protocol 2. */
      publicUrl: "",
      cloud: cloudStatus(),
      switcher,
    };
  }),

  route({ name: "settings.get", method: "GET", path: "/api/settings", summary: "kraftwerk.yml, parsed, with resolved paths" }, async () => getSettings()),
  route({ name: "settings.save", method: "PUT", path: "/api/settings", summary: "write the UI-editable subset of kraftwerk.yml", errors: 400, body: SettingsFields }, async (c) =>
    saveSettings((await c.body()) as SaveSettingsInput),
  ),

  route({ name: "workspaces.list", method: "GET", path: "/api/workspaces", summary: "every known workspace incl. this one, with state and counts" }, async () =>
    placeInHub(await listWorkspacesDetailed()),
  ),
  // Launches `kraftwerk ui` for a known workspace as a detached process (the switcher's Start button).
  route({ name: "workspaces.start", method: "POST", path: "/api/workspaces/start", summary: "start a known workspace {root}", errors: 400, body: z.object({ root: z.string().optional() }) }, async (c) => {
    const { root } = await c.body();
    if (!root) fail(400, "root required");
    // A daemon opens it itself, next to the workspace asking.
    const hub = currentHub();
    if (hub.daemon) {
      try {
        const o = await hub.open(absolutePath(root));
        return reply(200, { ok: true, url: o.url, slug: o.slug, here: true, live: true, pid: process.pid } as StartReply);
      } catch (err) {
        return reply(409, { ok: false, error: (err as Error).message } as StartReply);
      }
    }
    const result: StartReply = await startWorkspace(root);
    return reply(result.ok ? 200 : 409, result);
  }),
  route({ name: "workspaces.stop", method: "POST", path: "/api/workspaces/stop", summary: "stop a running workspace's server {root | url}", errors: 400, body: z.object({ root: z.string().optional(), url: z.string().optional() }) }, async (c) => {
    const target = await c.body();
    if (!target.root && !target.url) fail(400, "root or url required");
    // One the hub answering serves (not the one asking): closed right here.
    const hub = currentHub();
    const open = target.root ? hub.list().find((o) => o.root === absolutePath(target.root!)) : undefined;
    if (hub.daemon && open && open.root !== workspaceRoot()) {
      await hub.close(open.root);
      return reply(200, { ok: true } as { ok: boolean; error?: string });
    }
    const result = await stopWorkspace(target);
    return reply(result.ok ? 200 : 409, result);
  }),
  route({ name: "workspaces.forget", method: "POST", path: "/api/workspaces/forget", summary: "drop a workspace from the registry {root}", errors: 400, body: z.object({ root: z.string().optional() }) }, async (c) => {
    const { root } = await c.body();
    if (!root) fail(400, "root required");
    return { ok: await forgetWorkspace(root) };
  }),

  route({ name: "search.agents", method: "GET", path: "/api/search/agents", summary: "active agents and channels of every reachable workspace (⌘K)" }, async () =>
    searchAgents().then((r) => ({ workspaces: placeInHub(r.workspaces) })),
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
  route({ name: "update.start", method: "POST", path: "/api/update", summary: "self-update to {version?} (default latest)", errors: 409, body: z.object({ version: z.string().optional() }) }, async (c) => {
    const name = await getPkgName();
    const version = (await c.body()).version || "latest";
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
