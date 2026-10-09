import chalk from "chalk";
import type { Command } from "commander";
import { createPairCode, PAIR_CODE_TTL_MS } from "../core/devices.js";
import { findDaemon } from "../core/daemon.js";
import { keyFingerprint, readRelaySettings, relayEndpoint, remoteLink, setRelay, type RelayStatus } from "../server/relay.js";

/**
 * `kraftwerk remote` — this machine from anywhere: the daemon holds a
 * socket to the relay (kraftwerk cloud), and paired devices reach it through
 * there, end to end encrypted (src/client/relay.ts). No port is opened, no
 * router touched.
 *
 *   kraftwerk remote on [--url <cloud>]   turn it on (the running daemon follows at once)
 *   kraftwerk remote off
 *   kraftwerk remote                      the state
 *   kraftwerk remote pair                 a link that pairs a device from anywhere (10 minutes, once)
 */

type DaemonRelay = RelayStatus & { enabled: boolean; fingerprint: string | null };

/** Ask the running daemon (this machine: local trust). */
async function daemonRelay(method: "GET" | "POST", body?: unknown): Promise<DaemonRelay | null> {
  const d = await findDaemon();
  if (!d) return null;
  const r = await fetch(`http://127.0.0.1:${d.port}/api/devices/relay`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return r.ok ? ((await r.json()) as DaemonRelay) : null;
}

const describe = (s: DaemonRelay | null): string => {
  if (!s) return chalk.yellow("the daemon is not running — `kraftwerk daemon` (or `kraftwerk daemon install`) connects it");
  if (s.state === "connected") return `${chalk.green("connected")}${s.clients ? chalk.dim(` · ${s.clients} device${s.clients === 1 ? "" : "s"} connected now`) : ""}`;
  if (s.state === "connecting") return chalk.yellow("connecting…");
  if (s.state === "error") return chalk.red(`not connected: ${s.error ?? "unknown error"}`);
  return chalk.dim("off");
};

/** Wait briefly for the daemon's link to come up, so `remote on` says whether it worked. */
async function settle(): Promise<DaemonRelay | null> {
  let s = await daemonRelay("GET").catch(() => null);
  for (let i = 0; i < 20 && s?.state === "connecting"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    s = await daemonRelay("GET").catch(() => null);
  }
  return s;
}

export function registerRemoteCommand(program: Command): void {
  const remote = program
    .command("remote")
    .description("Reach this machine from anywhere through the relay, end to end encrypted: on, off, pair a device")
    .action(async () => {
      const s = await readRelaySettings();
      if (!s?.enabled) return void console.log(`${chalk.dim("Remote access is off.")} ${chalk.dim("`kraftwerk remote on` turns it on.")}`);
      console.log(`Remote access ${chalk.bold("on")} through ${chalk.cyan(s.url)} ${chalk.dim(`(machine key ${keyFingerprint(s.publicKey)})`)}`);
      console.log(`  ${describe(await daemonRelay("GET").catch(() => null))}`);
    });

  remote
    .command("on")
    .description("Turn remote access on: the daemon connects to the relay")
    .option("--url <url>", "The cloud whose relay to use (default: the kraftwerk cloud)")
    .action(async (opts: { url?: string }) => {
      if (opts.url && !/^https?:\/\//.test(opts.url)) {
        console.error(chalk.red("✖ --url is the cloud's address, e.g. https://srv.kraftwerk-cloud.netnode.cloud"));
        process.exit(2);
      }
      const s = await setRelay(true, opts.url);
      // The daemon reads the file again and connects; without one running, it does when it starts.
      await daemonRelay("POST", { enabled: true, ...(opts.url ? { url: opts.url } : {}) }).catch(() => null);
      const status = await settle();
      console.log(`${chalk.green("✔")} remote access on through ${chalk.cyan(s.url)} ${chalk.dim(`(${relayEndpoint(s.url, "server")})`)}`);
      console.log(`  ${describe(status)}`);
      console.log(chalk.dim("  `kraftwerk remote pair` makes a link that pairs a device"));
    });

  remote
    .command("off")
    .description("Turn remote access off: the daemon leaves the relay")
    .action(async () => {
      await setRelay(false);
      await daemonRelay("POST", { enabled: false }).catch(() => null);
      console.log(`${chalk.green("✔")} remote access off ${chalk.dim("(paired devices keep their pairing; `kraftwerk devices revoke` unpairs one)")}`);
    });

  remote
    .command("pair")
    .description(`A link that pairs a device from anywhere, valid ${PAIR_CODE_TTL_MS / 60_000} minutes, once`)
    .action(async () => {
      const s = await readRelaySettings();
      if (!s?.enabled) {
        console.error(chalk.red("✖ remote access is off — `kraftwerk remote on` first"));
        process.exit(1);
      }
      const { code } = await createPairCode();
      console.log(`${chalk.green("✔")} open this on the device ${chalk.dim(`— valid ${PAIR_CODE_TTL_MS / 60_000} minutes, once`)}`);
      console.log(`  ${chalk.cyan(remoteLink(s.url, s.publicKey, code))}`);
      console.log(chalk.dim(`  The link carries this machine's key and the code ${code}; treat it like a password.`));
      console.log(chalk.dim("  Or scan its QR code under Settings → Devices in the web UI."));
    });
}
