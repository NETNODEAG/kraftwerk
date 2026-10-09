import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { emptyTrash, listTrash, purgeFromTrash, restoreFromTrash, trashRoot } from "../core/trash.js";
import { fmtAgo } from "./workspaces.js";
import { initContext as prepare } from "./routines.js";

/**
 * `kraftwerk trash` — what was deleted (agents, projects, knowledge bundles,
 * vibeables, channels, repos, chats, runs), kept under kraftwerk-data/trash
 * until it is deleted from there:
 *
 *   kraftwerk trash                  list: id, what it was, when
 *   kraftwerk trash restore <id>     put an entry back where it came from
 *   kraftwerk trash purge <id>       delete one entry for good
 *   kraftwerk trash empty            delete everything in the trash for good
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

export function registerTrashCommands(program: Command): void {
  const trash = program.command("trash").description("What was deleted: list, restore, purge one, empty");

  trash
    .command("list", { isDefault: true })
    .description("List the trash, newest first")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const entries = await listTrash();
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(chalk.dim("The trash is empty."));
        return;
      }
      const table = new Table({ head: ["id", "was", "deleted"].map((h) => chalk.bold(h)), wordWrap: true });
      for (const e of entries) table.push([chalk.cyan(e.id), chalk.dim(e.from), chalk.dim(fmtAgo(e.trashedAt))]);
      console.log(table.toString());
      console.log(chalk.dim(await trashRoot()));
    });

  for (const [verb, fn, done] of [
    ["restore", restoreFromTrash, "restored"],
    ["purge", purgeFromTrash, "deleted for good:"],
  ] as const) {
    trash
      .command(verb)
      .description(verb === "restore" ? "Put an entry back where it came from" : "Delete one entry for good")
      .argument("<id>", "Entry id as `kraftwerk trash` lists it, e.g. knowledge/customer-support")
      .action(async (id: string) => {
        await prepare();
        try {
          const e = await fn(id);
          console.log(`${chalk.green("✔")} ${done} ${chalk.cyan(e.from)}`);
        } catch (err) {
          die((err as Error).message);
        }
      });
  }

  trash
    .command("empty")
    .description("Delete everything in the trash for good")
    .action(async () => {
      await prepare();
      const n = await emptyTrash();
      console.log(`${chalk.green("✔")} deleted ${n} entr${n === 1 ? "y" : "ies"} for good`);
    });
}
