import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { findDaemon } from "../core/daemon.js";
import { selfCommand } from "../core/self-command.js";
import { tildify } from "../core/instances.js";

/**
 * `kraftwerk daemon install` / `uninstall`: the daemon as a macOS login item
 * (a LaunchAgent), so it runs after a reboot without a terminal or the
 * desktop app. launchd starts the same `kraftwerk daemon` a terminal would —
 * this node, this install — with the PATH of the shell that installed it,
 * because launchd's own PATH would not find the agents (claude, codex, pi).
 * The daemon's supervisor restarts it after a self-update; launchd only
 * starts it at login.
 */

export const LAUNCH_LABEL = "ch.netnode.kraftwerk.daemon";

const plistPath = (): string => path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_LABEL}.plist`);
const logPath = (): string => path.join(os.homedir(), ".kraftwerk", "logs", "daemon.log");
/** A stand-in launchctl (tests); the real one otherwise. */
const launchctl = (): string => process.env.KRAFTWERK_LAUNCHCTL || "launchctl";
const domain = (): string => `gui/${os.userInfo().uid}`;

const xml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** The LaunchAgent: `program` at login, `env` set, output appended to `log`. */
export function renderPlist(program: string[], env: Record<string, string>, log: string): string {
  const strings = (xs: string[]) => xs.map((x) => `\t\t<string>${xml(x)}</string>`).join("\n");
  const vars = Object.entries(env)
    .map(([k, v]) => `\t\t<key>${xml(k)}</key>\n\t\t<string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LAUNCH_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${strings(program)}
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
${vars}
\t</dict>
\t<key>WorkingDirectory</key>
\t<string>${xml(os.homedir())}</string>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${xml(log)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(log)}</string>
</dict>
</plist>
`;
}

function requireMac(): void {
  if (process.platform !== "darwin") {
    console.error(chalk.red("✖ a login item is macOS only for now — run `kraftwerk daemon` from your system's startup instead"));
    process.exit(2);
  }
}

export async function installDaemon(opts: { port?: string }): Promise<void> {
  requireMac();
  const { cmd, args } = selfCommand(["daemon", ...(opts.port ? ["--port", opts.port] : [])]);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (process.env.KRAFTWERK_DAEMON_PORT && !opts.port) env.KRAFTWERK_DAEMON_PORT = process.env.KRAFTWERK_DAEMON_PORT;
  const file = plistPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.mkdir(path.dirname(logPath()), { recursive: true });
  await fs.writeFile(file, renderPlist([cmd, ...args], env, logPath()));
  // An older version of the item is replaced: unload it first (an error just means it was not loaded).
  spawnSync(launchctl(), ["bootout", `${domain()}/${LAUNCH_LABEL}`], { stdio: "ignore" });

  const running = await findDaemon();
  if (running) {
    // Loading now would start a second daemon, which refuses to run. launchd loads the file at the next login.
    console.log(`${chalk.green("✔")} login item installed: ${chalk.dim(tildify(file))}`);
    console.log(chalk.dim(`  a daemon already runs (pid ${running.pid}); from the next login on, launchd starts it`));
    return;
  }
  const r = spawnSync(launchctl(), ["bootstrap", domain(), file], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(chalk.red(`✖ launchctl bootstrap failed: ${(r.stderr || r.stdout || "").trim() || `exit ${r.status}`}`));
    console.error(chalk.dim(`  the file is in place (${tildify(file)}) and loads at the next login`));
    process.exit(1);
  }
  console.log(`${chalk.green("✔")} login item installed and started: ${chalk.dim(tildify(file))}`);
  console.log(chalk.dim(`  log: ${tildify(logPath())} · \`kraftwerk daemon uninstall\` removes it`));
}

export async function uninstallDaemon(): Promise<void> {
  requireMac();
  const file = plistPath();
  if (!existsSync(file)) {
    console.log(chalk.dim("No login item installed."));
    return;
  }
  // Unloading stops the daemon launchd started; one started from a terminal keeps running.
  spawnSync(launchctl(), ["bootout", `${domain()}/${LAUNCH_LABEL}`], { stdio: "ignore" });
  await fs.rm(file, { force: true });
  console.log(`${chalk.green("✔")} login item removed ${chalk.dim(`(${tildify(file)})`)}`);
}

/** For doctor: whether the login item is installed. */
export const daemonLoginItem = (): string | null => (existsSync(plistPath()) ? plistPath() : null);
