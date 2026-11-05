import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { cleanTemp, listTemp, SWEEP_AFTER_MS } from "../core/temp.js";
import { fmtAgo } from "./workspaces.js";
import { initContext as prepare } from "./routines.js";

/**
 * `kraftwerk temp` — the sessions' scratch folders under kraftwerk-data/temp
 * (one per chat session; TMPDIR of the agent process). Nothing in there is
 * a deliverable: a clean deletes for good, no trash.
 *
 *   kraftwerk temp                          list: session, files, size, last change
 *   kraftwerk temp clean                    remove folders idle for a week
 *   kraftwerk temp clean --older-than <d>   … idle for <d> days
 *   kraftwerk temp clean --all              remove every folder
 */

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

export function registerTempCommands(program: Command): void {
  const temp = program.command("temp").description("The sessions' scratch folders: list, clean");

  temp
    .command("list", { isDefault: true })
    .description("List the scratch folders, newest first")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const view = await listTemp();
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (view.entries.length === 0) {
        console.log(chalk.dim("No scratch folders."));
        console.log(chalk.dim(view.root));
        return;
      }
      const table = new Table({ head: ["session", "files", "size", "last change"].map((h) => chalk.bold(h)) });
      for (const e of view.entries) table.push([chalk.cyan(e.id), String(e.files), fmtBytes(e.bytes), chalk.dim(fmtAgo(e.modifiedAt))]);
      console.log(table.toString());
      console.log(chalk.dim(`${view.root} — ${fmtBytes(view.bytes)} in ${view.entries.length} folder${view.entries.length === 1 ? "" : "s"}`));
    });

  temp
    .command("clean")
    .description(`Remove scratch folders idle for ${SWEEP_AFTER_MS / 86_400_000} days (for good — nothing there is a deliverable)`)
    .option("--older-than <days>", "Remove folders idle for this many days instead")
    .option("--all", "Remove every folder, whatever its age")
    .option("--json", "Machine-readable output")
    .action(async (opts: { olderThan?: string; all?: boolean; json?: boolean }) => {
      await prepare();
      const days = opts.olderThan === undefined ? undefined : Number(opts.olderThan);
      if (days !== undefined && (!Number.isFinite(days) || days < 0)) {
        console.error(chalk.red(`--older-than wants a number of days, not "${opts.olderThan}"`));
        process.exit(2);
      }
      const gone = await cleanTemp({ all: opts.all, ...(days === undefined ? {} : { olderThanMs: days * 86_400_000 }) });
      const bytes = gone.reduce((n, e) => n + e.bytes, 0);
      if (opts.json) {
        console.log(JSON.stringify({ removed: gone.map((e) => e.id), bytes }, null, 2));
        return;
      }
      console.log(`${chalk.green("✔")} removed ${gone.length} folder${gone.length === 1 ? "" : "s"} (${fmtBytes(bytes)})`);
    });
}
