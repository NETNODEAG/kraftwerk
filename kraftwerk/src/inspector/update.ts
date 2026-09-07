import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

/**
 * Self-update from the inspector: one `npm i -g <name>@<version>` at a time,
 * run with the npm that belongs to the Node this server runs on, its output
 * kept for the UI. The install lands on disk; the existing relaunch
 * (/api/restart, supervised by `kraftwerk ui`) then switches to it.
 *
 * Refused where it cannot work: inside a container (the package is baked
 * into the image — rebuild instead), or when the global folder is not
 * writable by this process (a system Node that needs sudo).
 * KRAFTWERK_NPM points at the npm to use (tests point it at a stub).
 */

export interface UpdateStatus {
  state: "idle" | "running" | "done" | "failed";
  /** The version asked for ("latest" or a number). */
  version?: string;
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
}

const MAX_LOG = 200;
const IN_CONTAINER = existsSync("/.dockerenv") || existsSync("/run/.containerenv");

let status: UpdateStatus = { state: "idle", log: [] };

/** The npm next to the running node (nvm layouts), else npm on the PATH. */
export function npmCommand(): string {
  if (process.env.KRAFTWERK_NPM) return process.env.KRAFTWERK_NPM;
  const sibling = path.join(path.dirname(process.execPath), "npm");
  return existsSync(sibling) ? sibling : "npm";
}

/** Where a global install would go, and whether this process may write there. */
export function canSelfUpdate(name: string): { ok: true; root: string } | { ok: false; reason: string } {
  if (IN_CONTAINER) return { ok: false, reason: "running in a container — rebuild the image instead" };
  const r = spawnSync(npmCommand(), ["root", "-g"], { encoding: "utf8", timeout: 15_000 });
  const root = (r.stdout ?? "").trim();
  if (r.status !== 0 || !root) return { ok: false, reason: "could not find the global npm folder" };
  // The package folder if it exists, else the global root it would be created in.
  const target = existsSync(path.join(root, name)) ? path.join(root, name) : root;
  try {
    accessSync(target, constants.W_OK);
  } catch {
    return { ok: false, reason: `${target} is not writable by this process — run the install with the rights it needs` };
  }
  return { ok: true, root };
}

export function updateStatus(): UpdateStatus {
  return { ...status, log: [...status.log] };
}

/** Start the install; throws when one is running or the environment refuses it. */
export function startUpdate(name: string, version = "latest"): UpdateStatus {
  if (status.state === "running") throw new Error("an update is already running");
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(version)) throw new Error("invalid version");
  const can = canSelfUpdate(name);
  if (!can.ok) throw new Error(can.reason);

  const spec = `${name}@${version}`;
  status = { state: "running", version, log: [`$ npm i -g ${spec}`], startedAt: new Date().toISOString() };
  const push = (chunk: Buffer | string) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      status.log.push(line);
      if (status.log.length > MAX_LOG) status.log.splice(0, status.log.length - MAX_LOG);
    }
  };
  let child;
  try {
    child = spawn(npmCommand(), ["i", "-g", spec], {
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    status = { ...status, state: "failed", finishedAt: new Date().toISOString(), exitCode: null, log: [...status.log, (err as Error).message] };
    return updateStatus();
  }
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("error", (err) => push(err.message));
  child.on("close", (code) => {
    status = { ...status, state: code === 0 ? "done" : "failed", finishedAt: new Date().toISOString(), exitCode: code };
  });
  return updateStatus();
}
