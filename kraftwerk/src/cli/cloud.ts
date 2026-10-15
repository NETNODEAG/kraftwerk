import { spawn } from "node:child_process";
import os from "node:os";
import chalk from "chalk";
import type { Command } from "commander";
import {
  CloudError,
  claimUrlFor,
  envCloudOff,
  machineCloud,
  machineGoodbye,
  machineHeartbeat,
  machineRegister,
  machineUnlink,
  writeCloudFile,
  type Credentials,
} from "../core/cloud.js";
import { findDaemon } from "../core/daemon.js";
import { identityString, readIdentity } from "../core/identity.js";
import { relayId, fromBase64Url } from "../client/relay.js";
import type { CloudStatus } from "../server/cloud.js";
import { machineCredentials, readRelaySettings } from "../server/relay.js";
import { getPkgVersion } from "../server/version.js";

/**
 * `kraftwerk cloud | login | logout` — this machine in the kraftwerk cloud
 * (see core/cloud.ts). The running daemon holds the machine's record and is
 * asked first (/api/cloud…), so what it reports stays in step; without a
 * daemon `login` and `logout` talk to the cloud themselves with the
 * machine's credentials. No password ever passes through here: signing up
 * and signing in happen in the browser, on the claim page.
 *
 *   kraftwerk cloud [status]       registered? claimed? url, machine id, last heartbeat
 *   kraftwerk cloud on [--url]     the machine's switch (~/.kraftwerk/cloud.json); the daemon follows at once
 *   kraftwerk cloud off            … and says goodbye
 *   kraftwerk login [--open]       print the claim link and code, wait until the machine is claimed
 *   kraftwerk logout               release the claim; the cloud hands out a fresh code
 */

type DaemonCloud = CloudStatus & { daemon?: boolean; error?: string };

const POLL_MS = 2000;

async function daemonCloud(port: number, method: "GET" | "POST", route: string, body?: unknown): Promise<DaemonCloud> {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await r.json().catch(() => ({}))) as DaemonCloud;
  if (!r.ok) throw new Error(data.error ?? `${r.status} from the daemon`);
  return data;
}

const fail = (message: string, code = 1): never => {
  console.error(chalk.red(`✖ ${message}`));
  process.exit(code);
};

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {}
}

/** The machine's id without creating a key: null before the daemon's first start (or `kraftwerk login`). */
async function machineIdIfAny(): Promise<string | null> {
  const s = await readRelaySettings();
  return s ? relayId(fromBase64Url(s.publicKey)) : null;
}

async function hello() {
  const id = await readIdentity();
  return { name: id.machine, handle: id.handle, hostname: os.hostname(), platform: `${process.platform}-${process.arch}`, version: await getPkgVersion() };
}

function printClaim(st: Pick<CloudStatus, "claimCode" | "claimUrl" | "url">): void {
  if (!st.claimCode) return;
  console.log(`  claim code  ${chalk.bold(st.claimCode)}`);
  console.log(`  claim link  ${chalk.cyan(st.claimUrl ?? claimUrlFor(st.url, st.claimCode) ?? "")}`);
}

async function showStatus(opts: { json?: boolean }): Promise<void> {
  const [cloud, identity, id, daemon] = await Promise.all([machineCloud(), readIdentity(), machineIdIfAny(), findDaemon()]);
  const live = daemon ? await daemonCloud(daemon.port, "GET", "/api/cloud").catch(() => null) : null;
  const out = {
    enabled: cloud.enabled,
    url: cloud.url,
    source: cloud.source,
    ...(cloud.reason ? { reason: cloud.reason } : {}),
    machine: identityString(identity),
    id,
    daemon: !!daemon,
    state: live?.state ?? "off",
    registered: live?.state === "connected",
    claimed: !!live?.account,
    account: live?.account ?? null,
    claimCode: live?.claimCode ?? null,
    claimUrl: live?.claimUrl ?? null,
    lastSeen: live?.lastSeen ?? null,
    interval: live?.interval ?? null,
    workspaces: live?.workspaces ?? null,
    ...(live?.error ? { error: live.error } : {}),
  };
  if (opts.json) return void console.log(JSON.stringify(out, null, 2));

  const dot = !cloud.enabled ? chalk.dim("○") : out.claimed ? chalk.green("●") : out.registered ? chalk.yellow("●") : chalk.dim("●");
  console.log(`${dot} kraftwerk cloud ${cloud.enabled ? chalk.green("on") : chalk.dim("off")} ${chalk.dim(`${cloud.url} (${cloud.source})`)}`);
  if (!cloud.enabled) console.log(chalk.dim(`  ${cloud.reason}`));
  console.log(`  machine     ${identityString(identity)} ${chalk.dim(id ?? "no id yet — created at the daemon's first start")}`);
  if (!cloud.enabled) return;
  if (!daemon) {
    console.log(`  state       ${chalk.dim("not reporting — the daemon registers this machine (`kraftwerk daemon start`)")}`);
    return;
  }
  if (!live) return void console.log(`  state       ${chalk.yellow("the daemon did not answer")}`);
  if (live.state === "error") console.log(`  state       ${chalk.red("error")} ${chalk.dim(live.error ?? "")}`);
  else if (live.state !== "connected") console.log(`  state       ${live.state}`);
  else if (live.account) console.log(`  state       ${chalk.green("claimed")} by ${chalk.bold(live.account)}`);
  else console.log(`  state       ${chalk.yellow("registered, unclaimed")} ${chalk.dim("— `kraftwerk login` claims it")}`);
  if (live.state === "connected" && !live.account) printClaim(live);
  if (live.lastSeen) console.log(`  heartbeat   ${new Date(live.lastSeen).toLocaleTimeString()} ${chalk.dim(`every ${live.interval ?? 60}s · ${live.workspaces ?? 0} workspace${live.workspaces === 1 ? "" : "s"} reported`)}`);
}

async function setEnabled(enabled: boolean, url?: string): Promise<void> {
  if (url && !/^https?:\/\/[^/?#]+\/?$/.test(url)) fail("--url is the cloud's origin, e.g. https://srv.kraftwerk-cloud.netnode.cloud", 2);
  await writeCloudFile({ enabled, url });
  const cloud = await machineCloud();
  const daemon = await findDaemon();
  // The daemon follows at once (off: goodbye); best-effort — the file is what counts at its next start.
  const live = daemon ? await daemonCloud(daemon.port, "POST", "/api/cloud", { enabled, ...(url ? { url } : {}) }).catch(() => null) : null;
  if (!enabled) {
    console.log(`${chalk.green("✔")} cloud off for this machine ${chalk.dim(daemon ? (live ? "— the daemon said goodbye" : "— the daemon did not answer; it stops reporting at its next start") : "")}`);
    return;
  }
  if (envCloudOff()) console.log(chalk.yellow("⚠ KRAFTWERK_CLOUD_URL=off in this environment keeps it off here"));
  console.log(`${chalk.green("✔")} cloud on for this machine: ${chalk.cyan(cloud.url)}`);
  if (!daemon) console.log(chalk.dim("  the daemon registers this machine when it runs (`kraftwerk daemon start`); `kraftwerk login` claims it"));
  else if (live?.state === "connected") console.log(chalk.dim(live.account ? `  registered, claimed by ${live.account}` : "  registered — `kraftwerk login` claims it"));
  else if (live?.state === "error") console.log(chalk.yellow(`  the cloud did not answer: ${live.error ?? ""} (the daemon retries)`));
}

/**
 * The machine's record, the same shape either way: from the daemon, or —
 * without one — from the cloud directly (`direct` holds what heartbeats need).
 */
interface Session {
  status: () => Promise<Pick<CloudStatus, "state" | "url" | "account" | "claimCode" | "claimUrl" | "error" | "reason">>;
  end: () => Promise<void>;
}

async function session(): Promise<Session> {
  const daemon = await findDaemon();
  if (daemon) {
    const port = daemon.port;
    // Off in the daemon (it read cloud.json before `login` turned it on): turning it on registers.
    let first = true;
    return {
      status: async () => {
        const st = first ? await daemonCloud(port, "POST", "/api/cloud", { enabled: true }) : await daemonCloud(port, "POST", "/api/cloud/sync");
        first = false;
        return st;
      },
      end: async () => {},
    };
  }
  const cloud = await machineCloud();
  const version = await getPkgVersion();
  const creds: Credentials = await machineCredentials();
  let registered = false;
  return {
    status: async () => {
      try {
        const r = registered ? await machineHeartbeat(cloud.url, creds, { version }) : await machineRegister(cloud.url, creds, await hello(), []);
        registered = true;
        return { state: "connected", url: cloud.url, account: r.account, claimCode: r.claimCode, claimUrl: claimUrlFor(cloud.url, r.claimCode) };
      } catch (err) {
        if (err instanceof CloudError && err.status === 403) throw new Error(`${cloud.url} refuses this machine's secret (403) — another machine holds this id`);
        return { state: "error", url: cloud.url, error: (err as Error).message };
      }
    },
    // Without a daemon nothing reports afterwards: the record says so now instead of after the grace period.
    end: async () => {
      if (registered) await machineGoodbye(cloud.url, creds, version).catch(() => {});
    },
  };
}

async function login(opts: { open?: boolean; timeout?: string }): Promise<void> {
  if (envCloudOff()) fail("KRAFTWERK_CLOUD_URL=off in this environment — unset it to log in", 2);
  const timeout = Number(opts.timeout ?? 600);
  if (!Number.isFinite(timeout) || timeout <= 0) fail("--timeout must be a positive number of seconds", 2);
  const before = await machineCloud();
  if (!before.enabled) {
    await writeCloudFile({ enabled: true });
    console.log(chalk.dim("cloud turned on for this machine (`kraftwerk cloud off` turns it off)"));
  }
  const s = await session().catch((err: Error) => fail(err.message));
  try {
    let st = await s.status();
    if (st.state === "off") fail(`the daemon keeps the cloud off: ${st.reason ?? "off"}`);
    if (st.state !== "connected") fail(`could not reach ${st.url}: ${st.error ?? st.state}`);
    if (st.account) {
      console.log(`${chalk.green("✔")} already logged in as ${chalk.bold(st.account)} ${chalk.dim(`(${st.url}) — \`kraftwerk logout\` releases this machine`)}`);
      return;
    }
    if (!st.claimCode) fail(`${st.url} handed out no claim code`);
    console.log(`Sign in (or sign up) in the browser and claim this machine:`);
    printClaim(st);
    if (opts.open && st.claimUrl) openBrowser(st.claimUrl);
    console.log(chalk.dim(`waiting for the claim … (Ctrl-C stops; the code stays valid)`));
    const until = Date.now() + timeout * 1000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, until - Date.now()))));
      st = await s.status().catch((err: Error) => ({ ...st, state: "error" as const, error: err.message }));
      if (st.account) {
        console.log(`${chalk.green("✔")} logged in as ${chalk.bold(st.account)} ${chalk.dim(`— this machine is in your account at ${st.url}`)}`);
        return;
      }
    }
    fail(`not claimed within ${timeout}s — the code stays valid; \`kraftwerk login\` waits again`);
  } finally {
    await s.end();
  }
}

async function logout(): Promise<void> {
  if (envCloudOff()) fail("KRAFTWERK_CLOUD_URL=off in this environment", 2);
  const cloud = await machineCloud();
  if (!cloud.enabled) fail(`the cloud is off for this machine — ${cloud.reason}`, 2);
  const daemon = await findDaemon();
  let st: Pick<CloudStatus, "url" | "claimCode" | "claimUrl">;
  if (daemon) {
    st = await daemonCloud(daemon.port, "POST", "/api/cloud/unlink").catch((err: Error) => fail(err.message));
  } else {
    const creds = await machineCredentials();
    const r = await machineUnlink(cloud.url, creds, await getPkgVersion()).catch((err: Error) =>
      fail(err instanceof CloudError && err.status === 404 ? `this machine is not registered at ${cloud.url}` : `${cloud.url}: ${err.message}`),
    );
    st = { url: cloud.url, claimCode: r.claimCode, claimUrl: claimUrlFor(cloud.url, r.claimCode) };
  }
  console.log(`${chalk.green("✔")} logged out — this machine is unclaimed at ${st.url}`);
  printClaim(st);
  console.log(chalk.dim("  `kraftwerk login` claims it again"));
}

export function registerCloudCommands(program: Command): void {
  const cloud = program
    .command("cloud")
    .description("This machine in the kraftwerk cloud: status, on, off (`kraftwerk login` claims it)")
    .option("--json", "Machine-readable output")
    .addHelpText(
      "after",
      `
The daemon registers this machine once; its open workspaces ride along.
  kraftwerk cloud                 registered? claimed? url, machine id, last heartbeat
  kraftwerk cloud on [--url <u>]  turn it on (~/.kraftwerk/cloud.json); the daemon follows at once
  kraftwerk cloud off             turn it off; the running daemon says goodbye
  kraftwerk login [--open]        claim this machine into your account (in the browser)
  kraftwerk logout                release it
A workspace stays out with \`cloud: { enabled: false }\` in its kraftwerk.yml.`,
    )
    .action(async (opts: { json?: boolean }) => showStatus(opts));
  cloud
    .command("status")
    .description("Registered? claimed? url, machine id, last heartbeat")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => showStatus({ json: opts.json ?? (cloud.opts() as { json?: boolean }).json }));
  cloud
    .command("on")
    .description("Turn the cloud on for this machine (the running daemon registers at once)")
    .option("--url <url>", "The cloud's origin (default: the kraftwerk cloud)")
    .action(async (opts: { url?: string }) => setEnabled(true, opts.url));
  cloud
    .command("off")
    .description("Turn the cloud off for this machine (the running daemon says goodbye)")
    .action(async () => setEnabled(false));

  program
    .command("login")
    .description("Claim this machine into your kraftwerk cloud account: prints the claim link and code, waits for the claim")
    .option("--open", "Open the claim link in the browser")
    .option("--timeout <seconds>", "How long to wait for the claim", "600")
    .action(async (opts: { open?: boolean; timeout?: string }) => login(opts));
  program
    .command("logout")
    .description("Release this machine from its kraftwerk cloud account (a fresh claim code follows)")
    .action(async () => logout());
}
