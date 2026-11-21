import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { addWorkspaceId, resolveWorkspace, usersMode, type UsersMode } from "../config.js";
import { envCloudOff, writeCloudFile } from "../core/cloud.js";
import { workspaceRoot } from "../core/context.js";
import { ApiError } from "./api/router.js";
import { applyMachineCloud, cloudStatus, syncMachineCloud, type CloudStatus } from "./cloud.js";
import { currentHub } from "./hub-context.js";

/**
 * A workspace's mode — local or cloud — as one switch.
 *
 *   local  the default: everything in files on this machine, single player,
 *          no account. kraftwerk works fully without the cloud.
 *   cloud  the workspace is known to kraftwerk cloud: people sign in with
 *          their cloud account (kraftwerk.yml `users: cloud`), cloud boards
 *          are shared with everyone on the workspace, others join as remote
 *          members, and its owner reaches it from anywhere.
 *
 * Cloud mode needs three things besides `users: cloud`: the machine's cloud
 * on (~/.kraftwerk/cloud.json), the machine claimed by an account (`kraftwerk
 * login`), and the workspace's `id`. Switching to cloud does what it can at
 * once; while the machine is still connecting it answers `next: "connect"`,
 * and the claim happens in the browser, so until it lands it answers
 * `next: "claim"` with the link. The UI (or `kraftwerk cloud connect`) keeps
 * switching until it is done. `users: cloud` is written last — it makes the
 * browser sign in, which needs the rest.
 *
 * A workspace in cloud mode is always in the machine's cloud record;
 * `cloud.enabled: false` (the opt-out of the minimal usage report) only
 * applies in local mode and is never touched here, so switching back finds
 * it as it was (config.ts cloudIncluded). Switching back writes
 * `users: local` and leaves the machine as it is (other workspaces on it may
 * be in cloud mode). Switches of one workspace run one after the other: two
 * tabs or a tab and the CLI never write kraftwerk.yml at once (or give it
 * two ids).
 */

export type CloudStep = "machine" | "claim" | "workspace" | "signin";

export interface WorkspaceCloud {
  mode: UsersMode;
  /**
   * What switching to cloud still waits for: "connect" (the machine is
   * connecting — wait), "claim" (the browser — wait), "daemon" (only the
   * daemon connects) or "machine" (the cloud unreachable or off by the
   * environment) — those two need the person; null: nothing.
   */
  next: "daemon" | "machine" | "connect" | "claim" | null;
  steps: Record<CloudStep, boolean>;
  /** The cloud's address, and this workspace's page there once it has an id. */
  url: string;
  workspaceUrl: string | null;
  state: CloudStatus["state"];
  account: string | null;
  claimCode: string | null;
  claimUrl: string | null;
  /** Why the machine is not connected, when it is not. */
  problem?: string;
}

async function configDoc() {
  const ws = await resolveWorkspace(workspaceRoot());
  const configPath = ws.configPath ?? path.join(ws.root, "kraftwerk.yml");
  const raw = ws.configPath ? await fs.readFile(configPath, "utf8") : "";
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) throw new ApiError(400, `${path.basename(configPath)}: ${doc.errors[0].message}`);
  return { ws, configPath, doc };
}

export async function workspaceCloud(): Promise<WorkspaceCloud> {
  const ws = await resolveWorkspace(workspaceRoot());
  const st = cloudStatus();
  const daemon = currentHub().daemon === true;
  const connected = st.state === "connected";
  const claimed = connected && !!st.account;
  const id = !!ws.config.id;
  const mode = usersMode(ws.config);
  const steps = { machine: connected, claim: claimed, workspace: id, signin: mode === "cloud" };
  const next = mode === "cloud" && claimed ? null : !daemon ? "daemon" : !connected ? (st.state === "connecting" ? "connect" : "machine") : !claimed ? "claim" : null;
  const problem = !daemon
    ? "only the kraftwerk daemon connects to the cloud — run `kraftwerk daemon` and open the workspace there"
    : st.state === "error"
      ? `kraftwerk cloud does not answer: ${st.error ?? "unknown error"}`
      : st.state === "off" && envCloudOff()
        ? "the cloud is turned off by KRAFTWERK_CLOUD_URL=off"
        : undefined;
  return {
    mode,
    next,
    steps,
    url: st.url,
    workspaceUrl: id && st.url ? `${st.url}/w/${encodeURIComponent(ws.config.id!)}` : null,
    state: st.state,
    account: st.account ?? null,
    claimCode: st.claimCode ?? null,
    claimUrl: st.claimUrl ?? null,
    ...(problem ? { problem } : {}),
  };
}

/** One switch at a time per workspace (see the top). */
const queue = new Map<string, Promise<unknown>>();
function serially<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = queue.get(key) ?? Promise.resolve();
  const next = before.catch(() => {}).then(fn);
  queue.set(key, next);
  void next.finally(() => queue.get(key) === next && queue.delete(key)).catch(() => {});
  return next;
}

/** Switch the workspace to `mode`; to cloud as far as it goes now (see the top). */
export function setWorkspaceCloud(mode: UsersMode): Promise<WorkspaceCloud> {
  return serially(workspaceRoot(), () => (mode === "local" ? toLocal() : toCloud()));
}

async function writeUsersMode(mode: UsersMode): Promise<void> {
  const { configPath, doc } = await configDoc();
  doc.setIn(["users", "mode"], mode);
  await fs.writeFile(configPath, doc.toString());
}

async function toLocal(): Promise<WorkspaceCloud> {
  await writeUsersMode("local");
  // The record follows at once: an opted-out workspace drops out of it again.
  if (currentHub().daemon === true && cloudStatus().state === "connected") await syncMachineCloud().catch(() => {});
  return workspaceCloud();
}

async function toCloud(): Promise<WorkspaceCloud> {
  if (currentHub().daemon !== true || envCloudOff()) return workspaceCloud();
  // 1. The machine's cloud on.
  if (cloudStatus().state === "off") {
    await writeCloudFile({ enabled: true });
    await applyMachineCloud();
  }
  // 2. The workspace known by its id (a kraftwerk.yml made when there is none).
  const { ws, configPath, doc } = await configDoc();
  if (!ws.configPath) await fs.writeFile(configPath, doc.toString());
  if (!ws.config.id) await addWorkspaceId(configPath);
  // A round now: a claim made meanwhile shows, a connecting machine gets on.
  const st = await syncMachineCloud().catch(() => cloudStatus());
  // 3. The claim is the browser's; 4. sign-in comes once it is there.
  if (st.state !== "connected" || !st.account) return workspaceCloud();
  await writeUsersMode("cloud");
  // The cloud learns the workspace (an opted-out one is in now) before anyone signs in to it.
  await syncMachineCloud().catch(() => {});
  return workspaceCloud();
}
