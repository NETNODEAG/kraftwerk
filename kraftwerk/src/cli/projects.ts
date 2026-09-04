import path from "node:path";
import chalk from "chalk";
import { absolutePath } from "../config.js";
import Table from "cli-table3";
import type { Command } from "commander";
import {
  discoverWorkspaces,
  forgetProject,
  startProject,
  stopProject,
  tildify,
  type WorkspaceEntry,
} from "../inspector/instances.js";

/**
 * `kraftwerk projects` — every project that ever ran the inspector on this
 * machine (~/.kraftwerk/projects), joined with what is running right now.
 * The answer to "where did I start that UI, and how do I get it back":
 *
 *   kraftwerk projects                 list: name, root, running/stopped
 *   kraftwerk projects start <ref>     relaunch `kraftwerk ui` in that root, detached
 *   kraftwerk projects stop <ref>      SIGTERM a running UI (also ones started in a terminal)
 *   kraftwerk projects forget <ref>    drop the record (the folder stays)
 *
 * <ref> is a project name, the root's folder name, the root path, or a
 * port / localhost:port for running instances that recorded no root.
 */

export const fmtAgo = (iso?: string): string => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/**
 * Running → its url. Not running: "stopped" after a clean shutdown, "died"
 * when the last start has no matching stop (killed, crashed, terminal
 * closed) — the case this command exists for.
 */
const status = (e: WorkspaceEntry): string => {
  if (e.live) return chalk.green(`● ${e.url.replace(/^https?:\/\//, "")}`);
  if (e.exists === false) return chalk.red("path missing");
  const clean = !!e.lastStopped && !!e.lastStarted && e.lastStopped >= e.lastStarted;
  return clean ? chalk.dim("stopped") : chalk.yellow("died");
};

/** Match a ref against known workspaces; `needRoot` excludes rootless live instances (start/forget need a root). */
async function resolveRef(ref: string, needRoot = true): Promise<WorkspaceEntry> {
  const all = (await discoverWorkspaces()).filter((e) => e.root || !needRoot);
  const abs = absolutePath(ref);
  const port = /^\d+$/.test(ref) ? `http://localhost:${ref}` : `http://${ref.replace(/^https?:\/\//, "")}`;
  const hits = all.filter(
    (e) =>
      e.root === abs ||
      e.root === ref ||
      e.name === ref ||
      (e.root && path.basename(e.root) === ref) ||
      e.url === port
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    console.error(chalk.red(`No known project "${ref}". See \`kraftwerk projects\`.`));
    process.exit(2);
  }
  console.error(chalk.red(`"${ref}" is ambiguous — use the root path or port:`));
  for (const h of hits) console.error(`  ${h.root ?? h.url}`);
  process.exit(2);
}

export function registerProjectCommands(program: Command): void {
  const projects = program
    .command("projects")
    .description("Known kraftwerk projects on this machine: list, start a stopped UI, stop a running one, forget");

  projects
    .command("list", { isDefault: true })
    .description("List known projects with their root and whether the UI is running")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const entries = await discoverWorkspaces();
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(chalk.dim("No projects known yet — `kraftwerk ui` registers the current one."));
        return;
      }
      const table = new Table({
        head: ["project", "root", "status", "last started"].map((h) => chalk.bold(h)),
        wordWrap: true,
        colWidths: [22, 48, 24, 14],
      });
      for (const e of entries) {
        table.push([
          `${e.icon ? e.icon + " " : ""}${chalk.cyan(e.name)}`,
          e.rootLabel ?? chalk.dim("(no root recorded)"),
          status(e),
          fmtAgo(e.lastStarted),
        ]);
      }
      console.log(table.toString());
    });

  projects
    .command("start")
    .description("Relaunch the UI of a stopped project (detached; logs in ~/.kraftwerk/logs)")
    .argument("<ref>", "Project name, folder name, or root path")
    .action(async (ref: string) => {
      const entry = await resolveRef(ref);
      if (entry.live) {
        console.log(`${chalk.green("✔")} ${entry.name} already running: ${chalk.cyan(entry.url)}`);
        return;
      }
      const r = await startProject(entry.root!);
      if (!r.ok) {
        console.error(chalk.red(`Could not start ${entry.name}: ${r.error}`));
        if (r.log) console.error(chalk.dim(`log: ${tildify(r.log)}`));
        process.exit(1);
      }
      console.log(
        `${chalk.green("✔")} ${entry.name} ${r.live ? "running" : "starting"}: ${chalk.cyan(r.url)}` +
          chalk.dim(` (pid ${r.pid}${r.log ? `, log ${tildify(r.log)}` : ""})`)
      );
    });

  projects
    .command("stop")
    .description("Stop a running UI (SIGTERM to its server; works for terminal-started ones too)")
    .argument("<ref>", "Project name, folder name, root path, or port")
    .action(async (ref: string) => {
      const entry = await resolveRef(ref, false);
      if (!entry.live) {
        console.log(chalk.dim(`${entry.name} is not running.`));
        return;
      }
      const r = await stopProject({ root: entry.root, url: entry.url });
      if (!r.ok) {
        console.error(chalk.red(`Could not stop ${entry.name}: ${r.error}`));
        process.exit(1);
      }
      console.log(`${chalk.green("✔")} ${entry.name} stopped ${chalk.dim(`(${entry.url.replace(/^https?:\/\//, "")})`)}`);
    });

  projects
    .command("forget")
    .description("Remove a project from the registry (its folder is untouched)")
    .argument("<ref>", "Project name, folder name, or root path")
    .action(async (ref: string) => {
      const entry = await resolveRef(ref);
      if (await forgetProject(entry.root!)) {
        console.log(`${chalk.green("✔")} forgot ${entry.name} (${entry.rootLabel})`);
      } else {
        console.error(chalk.red(`No record for ${entry.root}`));
        process.exit(1);
      }
    });
}
