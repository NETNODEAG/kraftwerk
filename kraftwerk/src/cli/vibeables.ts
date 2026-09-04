import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { createVibeable, deleteVibeable, listVibeables } from "../inspector/vibeables.js";
import { fmtAgo } from "./projects.js";
import { initContext as prepare } from "./routines.js";

/**
 * `kraftwerk vibeables` — the small apps built live in a chat, one folder
 * each under the vibeables root (`vibeables.root` in kraftwerk.yml). The
 * same module the inspector uses, so an app created here shows up in every
 * chat's picker at once:
 *
 *   kraftwerk vibeables                    list: name, mode, state
 *   kraftwerk vibeables create <name>      new app from the starter (index.html, vibeable.yml)
 *   kraftwerk vibeables remove <name>      delete the folder (its history stays in the workspace git)
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

export function registerVibeableCommands(program: Command): void {
  const vibeables = program
    .command("vibeables")
    .description("Small apps built live in a chat: list, create one from the starter, remove");

  vibeables
    .command("list", { isDefault: true })
    .description("List the apps under the vibeables root")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const view = await listVibeables();
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (!view.enabled) die(view.error ?? "vibeables are off");
      if (view.vibeables.length === 0) {
        console.log(chalk.dim(`No vibeables under ${view.root} yet — \`kraftwerk vibeables create <name>\` starts one.`));
        return;
      }
      const table = new Table({
        head: ["name", "mode", "state", "changed"].map((h) => chalk.bold(h)),
        wordWrap: true,
        colWidths: [24, 30, 22, 14],
      });
      for (const v of view.vibeables) {
        table.push([
          chalk.cyan(v.slug),
          v.dev ? `dev: ${v.dev}` : "static",
          v.configError ? chalk.red(v.configError) : v.hasIndex ? chalk.dim("ready") : chalk.yellow("no index.html yet"),
          chalk.dim(fmtAgo(v.updatedAt)),
        ]);
      }
      console.log(table.toString());
      console.log(chalk.dim(view.root ?? ""));
    });

  vibeables
    .command("create")
    .description("Create an app folder from the starter (index.html, style.css, app.js, vibeable.yml)")
    .argument("<name>", "Folder name under the root")
    .option("--json", "Print the new entry as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      await prepare();
      try {
        const v = await createVibeable(name);
        if (opts.json) console.log(JSON.stringify(v, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(v.slug)} → ${v.path} ${chalk.dim("(open it from any chat with the vibeable button)")}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  vibeables
    .command("remove")
    .description("Delete an app folder; its history stays in the workspace git")
    .argument("<name>", "Folder name under the root")
    .action(async (name: string) => {
      await prepare();
      try {
        await deleteVibeable(name);
        console.log(`${chalk.green("✔")} removed ${chalk.cyan(name)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });
}
