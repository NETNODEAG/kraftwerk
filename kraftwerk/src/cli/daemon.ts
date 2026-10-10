import chalk from "chalk";
import type { Command } from "commander";
import { DAEMON_PORT, findDaemon, lastOpenRoots, writeDaemonFile } from "../core/daemon.js";
import { tildify } from "../core/instances.js";
import { networkUrls } from "../server/bind.js";
import { startPushWatcher } from "../server/push.js";
import { applyRelay, relayPush } from "../server/relay.js";
import { startHub } from "../server/server.js";
import { getPkgVersion } from "../server/version.js";
import { ensureBuilt, supervise } from "./ui.js";
import { installDaemon, uninstallDaemon } from "./daemon-login.js";

/**
 * `kraftwerk daemon` — the machine's kraftwerk: one process serving every
 * open workspace, each at `<slug>.localhost:<port>` (and its own port, when
 * free). `kraftwerk ui` in a workspace folder opens it there; `kraftwerk
 * workspaces stop <root>` closes it; the daemon reopens what was open when it
 * starts again. Runs in the foreground, restarted by a supervisor after a
 * self-update like `kraftwerk ui`.
 */
export async function runDaemon(opts: { port?: string; lan?: boolean }): Promise<void> {
  if (opts.lan) process.env.KRAFTWERK_UI_HOST ||= "0.0.0.0";
  if (process.env.KRAFTWERK_UI_SUPERVISED !== "1") return supervise(["daemon", ...(opts.port ? ["--port", opts.port] : [])], "the daemon");

  const running = await findDaemon();
  if (running && running.pid !== process.pid) {
    console.error(chalk.red(`✖ a kraftwerk daemon already runs (pid ${running.pid}, port ${running.port})`));
    process.exit(1);
  }
  const port = Number(opts.port ?? process.env.KRAFTWERK_DAEMON_PORT ?? DAEMON_PORT);
  const reopen = await lastOpenRoots();
  const hub = await startHub({
    port,
    staticDir: ensureBuilt(),
    daemon: true,
    onChange: (h) => writeDaemonFile(h.port, h.list().map((o) => o.root)),
  });
  await writeDaemonFile(hub.port, []);
  for (const root of reopen) {
    try {
      await hub.open(root);
    } catch (err) {
      console.log(`${chalk.yellow("⚠")} not reopened: ${tildify(root)} — ${(err as Error).message}`);
    }
  }
  console.log(`${chalk.green("✔")} kraftwerk daemon on ${chalk.cyan(`http://localhost:${hub.port}`)} ${chalk.dim(`(pid ${process.pid})`)}`);
  for (const o of hub.list()) console.log(`  ${chalk.cyan(o.url)} ${chalk.dim(o.name)}${o.aliasPort ? chalk.dim(` · also :${o.aliasPort}`) : ""}`);
  if (!hub.list().length) console.log(chalk.dim("  no workspace open yet — `kraftwerk ui` in a workspace folder opens it here"));
  // The relay (`kraftwerk remote on`): devices reach this machine from anywhere, end to end encrypted.
  const relay = await applyRelay(hub.port, await getPkgVersion(), (line) => console.log(chalk.dim(line)));
  // What needs you, pushed to the phones that asked (through the relay, sealed per device).
  startPushWatcher(hub, relayPush);
  if (relay.state !== "off") console.log(`${chalk.green("✔")} Reachable from anywhere through ${chalk.cyan(relay.url ?? "")} ${chalk.dim("(`kraftwerk remote pair` pairs a device)")}`);
  const lan = networkUrls(hub.port);
  if (lan.length) console.log(`${chalk.green("✔")} On your network: ${lan.map((u) => chalk.cyan(u)).join(", ")} ${chalk.dim("(add /w/<slug>/; devices pair first)")}`);
}

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Run the machine's kraftwerk: one process serving every open workspace at <slug>.localhost; install it as a login item")
    .option("--port <port>", `Port (default: KRAFTWERK_DAEMON_PORT, else ${DAEMON_PORT})`)
    .option("--lan", "Listen on the network too, for paired devices")
    .action(async (opts: { port?: string; lan?: boolean }) => {
      await runDaemon(opts);
    });
  daemon
    .command("install")
    .description("Start the daemon at login (macOS LaunchAgent), and now unless one runs")
    .option("--port <port>", `Port (default: KRAFTWERK_DAEMON_PORT, else ${DAEMON_PORT})`)
    .option("--lan", "Listen on the network too, for paired devices (a phone on the same Wi-Fi)")
    .action(async (opts: { port?: string; lan?: boolean }) => {
      // `--port`/`--lan` after `install` are taken by `daemon` itself, which has the same options.
      const parent = daemon.opts() as { port?: string; lan?: boolean };
      await installDaemon({ port: opts.port ?? parent.port, lan: opts.lan ?? parent.lan });
    });
  daemon
    .command("uninstall")
    .description("Remove the login item (stops a daemon launchd started)")
    .action(async () => {
      await uninstallDaemon();
    });
}
