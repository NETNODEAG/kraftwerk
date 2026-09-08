import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { parseDocument } from "yaml";
import { parsePublic, publicHostFor, resolveProject, tunnelFor, type Project } from "../config.js";

/**
 * Cloudflare Tunnel next to the inspector. `kraftwerk ui` runs cloudflared
 * as a sibling of the server so the loopback bind is reachable at the
 * project's public hostname without opening a port. The tunnel itself is
 * created once, by `kraftwerk tunnel setup` or by hand:
 *
 *   locally-managed      cloudflared tunnel login
 *                        cloudflared tunnel create kraftwerk
 *                        cloudflared tunnel route dns kraftwerk kw.example.com
 *                        → tunnel: { name: kraftwerk }; everything routes to the inspector port
 *   dashboard-managed    create the tunnel in Zero Trust → Networks → Tunnels, route the
 *                        public hostname to http://localhost:<port> there, export TUNNEL_TOKEN
 *                        → tunnel: {} ; cloudflared reads the token from the environment
 *
 * cloudflared reconnects on its own; this only respawns it when the process
 * itself dies, after a pause. A process that keeps dying right after launch
 * (no login, unknown tunnel name) is a configuration problem: after a few
 * such exits the tunnel gives up and says so, and the UI stays local.
 *
 *   kraftwerk tunnel                   run the configured tunnel alone (the UI runs elsewhere)
 *   kraftwerk tunnel setup <hostname>  login, create, route dns, write public: + tunnel.name
 */

const RESPAWN_DELAY = 5_000;
/** An exit this soon after launch is a configuration problem, not a hiccup. */
const FAST_EXIT = 10_000;
const MAX_FAST_EXITS = 3;

export interface RunningTunnel {
  stop(): void;
  /** Settles when the tunnel was stopped, or gave up on a cloudflared that keeps dying. */
  done: Promise<"stopped" | "failed">;
}

/** Start cloudflared for the project's tunnel, or return undefined (nothing to run, or told why not). */
export function startTunnel(project: Project, port: number): RunningTunnel | undefined {
  const tunnel = tunnelFor(project);
  if (!tunnel) return undefined;
  const host = publicHostFor(project);

  let args: string[];
  if (tunnel.name) {
    args = ["tunnel", "--no-autoupdate", "run", "--url", `http://127.0.0.1:${port}`, tunnel.name];
  } else if (process.env.TUNNEL_TOKEN) {
    args = ["tunnel", "--no-autoupdate", "run"];
  } else {
    console.error(
      `${chalk.red("✖")} tunnel: nothing to run — set ${chalk.bold("tunnel.name")} in kraftwerk.yml (locally-managed) ` +
        `or the ${chalk.bold("TUNNEL_TOKEN")} environment variable (dashboard-managed). The UI stays local.`
    );
    return undefined;
  }

  let child: ChildProcess | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let fastExits = 0;
  let settle: (outcome: "stopped" | "failed") => void = () => {};
  const done = new Promise<"stopped" | "failed">((resolve) => (settle = resolve));

  const launch = (): void => {
    const startedAt = Date.now();
    console.log(
      `${chalk.dim("↗")} tunnel: ${tunnel.name ? `running ${chalk.bold(tunnel.name)}` : "running the dashboard-managed tunnel"}` +
        chalk.dim(` → https://${host} → http://127.0.0.1:${port}`)
    );
    child = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });
    // cloudflared logs on stderr, one line per event; keep them recognisable.
    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) console.log(chalk.dim(`  cloudflared │ ${line}`));
    };
    child.stdout?.on("data", relay);
    child.stderr?.on("data", relay);
    child.once("error", (err: NodeJS.ErrnoException) => {
      stopped = true;
      if (err.code === "ENOENT") {
        console.error(`${chalk.red("✖")} tunnel: cloudflared not found — brew install cloudflared (or see developers.cloudflare.com). The UI stays local.`);
      } else {
        console.error(`${chalk.red("✖")} tunnel: cannot start cloudflared: ${err.message}`);
      }
      settle("failed");
    });
    // "close", not "exit": the last log lines are still in flight when the
    // process ends, and they are what explains a failed launch.
    child.once("close", (code, signal) => {
      child = undefined;
      if (stopped) return settle("stopped");
      fastExits = Date.now() - startedAt < FAST_EXIT ? fastExits + 1 : 0;
      if (fastExits >= MAX_FAST_EXITS) {
        console.error(
          `${chalk.red("✖")} tunnel: cloudflared exited ${MAX_FAST_EXITS} times right after launch — giving up. ` +
            `Check the messages above (cloudflared tunnel login? does the tunnel exist?), then restart the UI. The UI stays local.`
        );
        return settle("failed");
      }
      console.error(`${chalk.red("✖")} tunnel: cloudflared exited (${signal ?? `code ${code}`}) — retrying in ${RESPAWN_DELAY / 1000}s`);
      timer = setTimeout(launch, RESPAWN_DELAY);
    });
  };
  launch();

  return {
    done,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (child) child.kill("SIGTERM");
      else settle("stopped");
    },
  };
}

// ---------------------------------------------------------------------------
// CLI

const die = (msg: string, code = 1): never => {
  console.error(chalk.red(msg));
  process.exit(code);
};

/** cloudflared's version line, or undefined when the binary is not on PATH. */
function cloudflaredVersion(): string | undefined {
  const r = spawnSync("cloudflared", ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (r.error || r.status !== 0) return undefined;
  return (r.stdout || r.stderr).trim().split("\n")[0];
}

/** Run one cloudflared command to completion, capturing its output (stderr carries the log lines). */
function cloudflared(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("cloudflared", args, { encoding: "utf8", timeout: 120_000, stdio: ["inherit", "pipe", "pipe"] });
  return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Whether something already answers on the inspector port (so the tunnel has an origin). */
function inspectorListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/meta?probe=1", timeout: 1_500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** A tunnel name from the project's display name or folder: "kraftwerk-agent-playground". */
function defaultTunnelName(project: Project): string {
  const base = (project.config.name ?? path.basename(project.root)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `kraftwerk-${base || "inspector"}`;
}

/** The origin certificate `cloudflared tunnel login` writes; its presence means an authorized zone. */
function originCertPath(): string {
  return process.env.TUNNEL_ORIGIN_CERT || path.join(os.homedir(), ".cloudflared", "cert.pem");
}

/** Write public: and tunnel.name into kraftwerk.yml, keeping everything else (comments, an access block) as it is. */
async function writeTunnelConfig(project: Project, publicUrl: string, name: string): Promise<string> {
  const configPath = project.configPath!;
  const doc = parseDocument(await readFile(configPath, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path.basename(configPath)}: ${doc.errors[0].message}`);
  doc.set("public", publicUrl);
  const tunnel = doc.get("tunnel");
  if (tunnel && typeof tunnel === "object") {
    doc.setIn(["tunnel", "name"], name);
    doc.deleteIn(["tunnel", "enabled"]);
  } else {
    doc.set("tunnel", { name });
  }
  await writeFile(configPath, doc.toString());
  return configPath;
}

export function registerTunnelCommands(program: Command): void {
  const tunnel = program
    .command("tunnel")
    .description("Cloudflare Tunnel to the inspector: run the configured one alone, or set one up");

  tunnel
    .command("run", { isDefault: true })
    .description("Run the project's tunnel in the foreground (the inspector runs separately, e.g. `kraftwerk ui` elsewhere)")
    .option("--port <port>", "Inspector port to route to (default: kraftwerk.yml `port`, else 1981)")
    .action(async (opts: { port?: string }) => {
      const project = await resolveProject(process.cwd()).catch((err: Error) => die(err.message, 2));
      if (!tunnelFor(project)) {
        die(
          "tunnel is off — `kraftwerk tunnel setup <hostname>` creates one, or add `public:` and `tunnel:` to kraftwerk.yml (see kraftwerk doctor)."
        );
      }
      const port = opts.port ? Number(opts.port) : (project.config.port ?? 1981);
      if (!Number.isInteger(port) || port <= 0) die("--port must be a port number", 2);
      if (!(await inspectorListening(port))) {
        console.log(chalk.yellow(`⚠ nothing answers on http://127.0.0.1:${port} yet — start \`kraftwerk ui\`; the tunnel serves errors until then.`));
      }
      const running = startTunnel(project, port);
      if (!running) process.exit(1);
      for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => running.stop());
      const outcome = await running.done;
      process.exit(outcome === "failed" ? 1 : 0);
    });

  tunnel
    .command("setup <hostname>")
    .description("Create a locally-managed tunnel for this project and route the hostname to it (login, create, route dns, kraftwerk.yml)")
    .option("--name <name>", "Tunnel name (default: kraftwerk-<project name>)")
    .option("--overwrite-dns", "Replace an existing DNS record for the hostname")
    .action(async (hostname: string, opts: { name?: string; overwriteDns?: boolean }) => {
      const host = parsePublic(hostname)?.hostname ?? die(`"${hostname}" is not a hostname — expected something like kw.example.com`, 2);
      const project = await resolveProject(process.cwd()).catch((err: Error) => die(err.message, 2));
      if (!project.configPath) die("no kraftwerk.yml here — `kraftwerk init` scaffolds one, then run setup again.", 2);
      const name = opts.name ?? defaultTunnelName(project);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) die(`"${name}" is not a plain tunnel name (letters, digits, ".", "_", "-")`, 2);

      const version = cloudflaredVersion();
      if (!version) die("cloudflared not found — brew install cloudflared (or see developers.cloudflare.com), then run setup again.");
      console.log(`${chalk.green("✔")} ${version}`);

      // 1. Login: one authorized zone at a time, stored as cert.pem.
      if (existsSync(originCertPath())) {
        console.log(`${chalk.green("✔")} logged in to Cloudflare ${chalk.dim(`(${originCertPath()})`)}`);
      } else {
        console.log(`${chalk.dim("↗")} cloudflared tunnel login — pick the zone that ${chalk.bold(host)} belongs to in the browser`);
        const login = spawnSync("cloudflared", ["tunnel", "login"], { stdio: "inherit" });
        if (login.error || login.status !== 0 || !existsSync(originCertPath())) die("cloudflared tunnel login did not complete.");
        console.log(`${chalk.green("✔")} logged in to Cloudflare`);
      }

      // 2. The tunnel: reuse one of that name, else create it.
      const list = cloudflared(["tunnel", "list", "--output", "json", "--name", name]);
      if (!list.ok) die(`cloudflared tunnel list failed:\n${list.out}`);
      let existing: { id?: string; name?: string } | undefined;
      try {
        existing = (JSON.parse(list.out || "[]") as Array<{ id?: string; name?: string }>).find((t) => t.name === name);
      } catch {
        die(`cloudflared tunnel list returned no JSON:\n${list.out}`);
      }
      let id: string | undefined = existing?.id;
      if (existing) {
        console.log(`${chalk.green("✔")} tunnel ${chalk.bold(name)} exists ${chalk.dim(id ?? "")}`);
      } else {
        const created = cloudflared(["tunnel", "create", "--output", "json", name]);
        if (!created.ok) die(`cloudflared tunnel create failed:\n${created.out}`);
        try {
          id = (JSON.parse(created.out) as { id?: string }).id;
        } catch {
          // Not fatal: the route step addresses the tunnel by name.
        }
        console.log(`${chalk.green("✔")} created tunnel ${chalk.bold(name)} ${chalk.dim(id ?? "")}`);
      }

      // 3. DNS: a CNAME from the hostname to the tunnel. cloudflared can
      // exit 0 after quietly appending the authorized zone to a hostname
      // outside it — compare the record it reports with the one asked for.
      const route = cloudflared(["tunnel", "route", "dns", ...(opts.overwriteDns ? ["--overwrite-dns"] : []), name, host]);
      const added = /Added CNAME (\S+)/.exec(route.out)?.[1]?.replace(/\.$/, "").toLowerCase();
      if (!route.ok) {
        const exists = /already exists/i.test(route.out);
        die(
          `cloudflared tunnel route dns failed:\n${route.out}` +
            (exists && !opts.overwriteDns ? `\n\nA record for ${host} exists. If it should point at this tunnel, run setup again with --overwrite-dns.` : "")
        );
      }
      if (added && added !== host.toLowerCase()) {
        die(
          `cloudflared routed ${chalk.bold(added)} instead of ${chalk.bold(host)}: the hostname is outside the zone you logged in to.\n` +
            `Delete the stray CNAME ${added} in the Cloudflare dashboard, run \`cloudflared tunnel login\` for the right zone, then setup again.`
        );
      }
      console.log(`${chalk.green("✔")} ${host} → tunnel ${name}`);

      // 4. kraftwerk.yml
      const publicUrl = `https://${host}`;
      const configPath = await writeTunnelConfig(project, publicUrl, name).catch((err: Error) => die(err.message));
      console.log(`${chalk.green("✔")} ${path.basename(configPath)}: public: ${publicUrl}, tunnel.name: ${name}`);

      const port = project.config.port ?? 1981;
      console.log(
        `\n${chalk.bold("Next:")} put a Cloudflare Access policy on ${host} — the UI has no login of its own.\n` +
          `  Zero Trust → Access → Applications → Add an application → Self-hosted, domain ${host}: https://one.dash.cloudflare.com/\n` +
          `  Then copy the team name and the application's Audience tag into kraftwerk.yml so the inspector verifies every login:\n` +
          chalk.dim(`    tunnel:\n      name: ${name}\n      access:\n        team: <team>          # https://<team>.cloudflareaccess.com\n        aud: <audience tag>\n`) +
          `\n\`kraftwerk ui\` now starts the tunnel with the inspector (port ${port}); \`kraftwerk tunnel\` runs it alone. \`kraftwerk doctor\` checks it.`
      );
    });
}
