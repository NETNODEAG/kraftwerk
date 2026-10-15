import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { daemonLogPath, daemonState, findDaemon, readDaemonFile } from "../core/daemon.js";
import { tildify } from "../core/instances.js";
import { selfCommand } from "../core/self-command.js";
import { getPkgVersion } from "../server/version.js";
import { daemonLoginItem, startLoginItem } from "./daemon-login.js";

/**
 * `kraftwerk daemon status | start | stop | restart | logs`: the daemon from
 * the outside, without a terminal of its own. `start` (and `kraftwerk daemon
 * -d`) runs it in the background — through the login item when one is
 * installed, else as a detached process — writing to the daemon log, which
 * `logs` shows (`-f` follows). `status` asks the daemon itself, never the
 * file alone, and exits 3 when none runs (as `systemctl status` does), so a
 * script can tell.
 */

const NOT_RUNNING = 3;

const alive = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ago = (iso: string | undefined): string => {
  const ms = iso ? Date.now() - Date.parse(iso) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

async function getJson<T>(port: number, p: string): Promise<T | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The last lines of the daemon log ([] without one). */
async function tail(n: number): Promise<string[]> {
  try {
    const lines = (await fs.readFile(daemonLogPath(), "utf8")).split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-n);
  } catch {
    return [];
  }
}

interface Status {
  running: boolean;
  /** Running, but it did not answer in time: its process lives and holds its port (agents at work, a loaded machine). */
  busy?: boolean;
  pid?: number;
  port?: number;
  version?: string;
  installed: string;
  startedAt?: string;
  workspaces?: Array<{ slug: string; name: string; url: string }>;
  remote?: { state: string; url?: string; clients?: number };
  loginItem: boolean;
  log: string;
}

async function status(): Promise<Status> {
  const [found, rec, installed] = await Promise.all([daemonState(), readDaemonFile(), getPkgVersion()]);
  const base = { installed, loginItem: daemonLoginItem() !== null, log: daemonLogPath() };
  if (found.state === "stopped") return { running: false, ...base };
  const running = found;
  if (found.state === "busy") {
    return { running: true, busy: true, ...base, pid: found.pid, port: found.port, ...(rec?.version ? { version: rec.version } : {}), ...(rec?.startedAt ? { startedAt: rec.startedAt } : {}) };
  }
  const [hub, relay] = await Promise.all([
    getJson<{ workspaces?: Array<{ slug: string; name: string; url: string }> }>(running.port, "/api/hub"),
    getJson<{ enabled?: boolean; state?: string; url?: string; clients?: number }>(running.port, "/api/devices/relay"),
  ]);
  return {
    running: true,
    ...base,
    pid: running.pid,
    port: running.port,
    ...(rec?.version ? { version: rec.version } : {}),
    ...(rec?.startedAt ? { startedAt: rec.startedAt } : {}),
    workspaces: (hub?.workspaces ?? []).map(({ slug, name, url }) => ({ slug, name, url })),
    ...(relay?.enabled ? { remote: { state: relay.state ?? "unknown", ...(relay.url ? { url: relay.url } : {}), clients: relay.clients ?? 0 } } : {}),
  };
}

export async function daemonStatus(opts: { json?: boolean }): Promise<void> {
  const s = await status();
  if (opts.json) {
    console.log(JSON.stringify(s, null, 2));
    process.exit(s.running ? 0 : NOT_RUNNING);
  }
  if (s.busy) {
    const up = ago(s.startedAt);
    console.log(`${chalk.yellow("●")} kraftwerk daemon ${chalk.yellow("running, but slow to answer")} ${chalk.dim(`pid ${s.pid}, port ${s.port}${up ? `, up ${up}` : ""}${s.version ? `, ${s.version}` : ""}`)}`);
    console.log(chalk.dim("  its process lives and holds its port — busy (agents at work, a loaded machine); ask again in a moment"));
  } else if (s.running) {
    const up = ago(s.startedAt);
    const behind = s.version && s.version !== s.installed ? chalk.yellow(` — ${s.installed} is installed: \`kraftwerk daemon restart\``) : "";
    console.log(`${chalk.green("●")} kraftwerk daemon ${chalk.green("running")} ${chalk.dim(`pid ${s.pid}${up ? `, up ${up}` : ""}${s.version ? `, ${s.version}` : ""}`)}${behind}`);
    console.log(`  ${chalk.cyan(`http://localhost:${s.port}`)} · ${s.workspaces?.length ?? 0} workspace${s.workspaces?.length === 1 ? "" : "s"} open`);
    for (const w of s.workspaces ?? []) console.log(`    ${w.name} ${chalk.dim(w.url)}`);
    if (s.remote) {
      const ok = s.remote.state === "connected";
      const devices = ok ? chalk.dim(` · ${s.remote.clients} device connection${s.remote.clients === 1 ? "" : "s"} now`) : "";
      // Just started, the link reports "off" until it has dialled the relay.
      const state = s.remote.state === "off" ? "connecting …" : s.remote.state;
      console.log(`  remote access: ${ok ? chalk.green("connected") : chalk.yellow(state)}${s.remote.url ? chalk.dim(` through ${s.remote.url}`) : ""}${devices}`);
    }
  } else {
    console.log(`${chalk.red("○")} kraftwerk daemon ${chalk.red("not running")}`);
    const last = await tail(400);
    const crash = [...last].reverse().find((l) => /crashed:|stopped unexpectedly/.test(l));
    if (crash) console.log(chalk.dim(`  last trouble in the log: ${crash.trim().slice(0, 200)}`));
    console.log(chalk.dim("  `kraftwerk daemon start` starts it in the background"));
  }
  console.log(chalk.dim(`  login item: ${s.loginItem ? "starts at login" : "not installed (`kraftwerk daemon install` starts it at login)"}`));
  console.log(chalk.dim(`  log: ${tildify(s.log)} · \`kraftwerk daemon logs -f\` follows it`));
  if (!s.running) process.exit(NOT_RUNNING);
}

/** Wait until `ok` holds (polling), up to `ms`; whether it did. */
async function until(ok: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return ok();
}

/** Start it in the background: the login item when installed (launchd owns it then), else a detached process writing to the log. */
async function launch(port: string | undefined): Promise<"login item" | "background"> {
  if (daemonLoginItem() && !port && startLoginItem()) return "login item";
  const log = daemonLogPath();
  mkdirSync(path.dirname(log), { recursive: true });
  const out = openSync(log, "a");
  const { cmd, args } = selfCommand(["daemon", ...(port ? ["--port", port] : [])]);
  const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: process.env.HOME, env: { ...process.env, FORCE_COLOR: "0" } });
  child.unref();
  return "background";
}

export async function startDaemon(opts: { port?: string }): Promise<void> {
  const running = await daemonState();
  if (running.state !== "stopped") {
    const busy = running.state === "busy" ? ", busy — slow to answer right now" : "";
    console.log(`${chalk.green("✔")} the daemon already runs ${chalk.dim(`(pid ${running.pid}, http://localhost:${running.port}${busy})`)}`);
    return;
  }
  const how = await launch(opts.port);
  process.stdout.write(chalk.dim(`starting the daemon (${how}) …`));
  const up = await until(async () => (await findDaemon()) !== null, 45_000);
  process.stdout.write("\n");
  if (!up) {
    console.error(chalk.red("✖ the daemon did not come up — its log says:"));
    for (const l of await tail(15)) console.error(chalk.dim(`  ${l}`));
    process.exit(1);
  }
  await daemonStatus({});
}

/** Stop it: its supervisor first (else it would start the daemon again), then wait until it is gone. */
async function stopRunning(): Promise<boolean> {
  const [found, rec] = await Promise.all([daemonState(), readDaemonFile()]);
  if (found.state === "stopped") return false;
  const running = found;
  const target = rec?.pid === running.pid && alive(rec.supervisor) ? rec.supervisor! : running.pid;
  process.kill(target, "SIGTERM");
  const gone = await until(async () => !alive(running.pid) && !alive(target) && (await findDaemon()) === null, 20_000);
  if (!gone) {
    for (const pid of [target, running.pid]) if (alive(pid)) process.kill(pid, "SIGKILL");
    await until(async () => (await findDaemon()) === null, 5_000);
  }
  return true;
}

export async function stopDaemon(): Promise<void> {
  if (!(await stopRunning())) {
    console.log(chalk.dim("No daemon running."));
    return;
  }
  console.log(`${chalk.green("✔")} daemon stopped`);
  if (daemonLoginItem()) console.log(chalk.dim("  it starts again at the next login (`kraftwerk daemon uninstall` stops that)"));
}

/** Restart: the running daemon relaunches itself with the current install (its supervisor stays); none running — start one. */
export async function restartDaemon(opts: { port?: string }): Promise<void> {
  const found = await daemonState();
  if (found.state === "stopped") return startDaemon(opts);
  if (found.state === "busy") {
    // It does not answer, so it cannot be asked to relaunch: stopping it is the only way (its agents are interrupted).
    await stopRunning();
    return startDaemon(opts);
  }
  const running = found;
  // The restart route lives in every workspace (the daemon's root answers machine routes only); any open one will do.
  const hub = await getJson<{ workspaces?: Array<{ slug: string }> }>(running.port, "/api/hub");
  const slug = hub?.workspaces?.[0]?.slug;
  const asked =
    !!slug &&
    (await fetch(`http://127.0.0.1:${running.port}/w/${encodeURIComponent(slug)}/api/restart`, { method: "POST", signal: AbortSignal.timeout(5000) }).then(
      (r) => r.ok,
      () => false,
    ));
  if (!asked) {
    // Not supervised (an old daemon, a foreground one started oddly): stop it and start a new one.
    await stopRunning();
    return startDaemon(opts);
  }
  process.stdout.write(chalk.dim("restarting the daemon …"));
  const back = await until(async () => {
    const d = await findDaemon();
    return d !== null && d.pid !== running.pid;
  }, 45_000);
  process.stdout.write("\n");
  if (!back) {
    console.error(chalk.red("✖ the daemon did not come back — its log says:"));
    for (const l of await tail(15)) console.error(chalk.dim(`  ${l}`));
    process.exit(1);
  }
  await daemonStatus({});
}

export async function daemonLogs(opts: { lines?: string; follow?: boolean }): Promise<void> {
  const log = daemonLogPath();
  const n = Math.max(1, Number(opts.lines ?? 50) || 50);
  if (!existsSync(log)) {
    console.log(chalk.dim(`No daemon log yet (${tildify(log)}): a daemon in the background writes it — one in a terminal writes there instead.`));
    if (!opts.follow) return;
    mkdirSync(path.dirname(log), { recursive: true });
    await fs.appendFile(log, "");
  }
  if (!opts.follow) {
    for (const l of await tail(n)) console.log(l);
    return;
  }
  // tail -F keeps following when the file is replaced; Ctrl-C ends it.
  const child = spawn("tail", ["-n", String(n), "-F", log], { stdio: "inherit" });
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
