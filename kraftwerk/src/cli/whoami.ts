import chalk from "chalk";
import type { Command } from "commander";
import { identityPartError, identityString, readIdentity, setIdentity } from "../core/identity.js";

/**
 * `kraftwerk whoami` — this machine's identity (~/.kraftwerk/identity.json):
 * the handle, the machine name, and `handle@machine`, which routines name in
 * `runs_on:` so only one clone of a workspace fires them. `--handle` /
 * `--machine` rename; the old pair is kept in `previous`, and doctor offers
 * to move routines that still name it.
 */

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("This machine's identity (handle@machine) — the runner routines name in runs_on; --handle / --machine rename it")
    .option("--handle <handle>", "Set your handle (lowercase letters, digits, . _ -)")
    .option("--machine <machine>", "Set this machine's name (lowercase letters, digits, . _ -)")
    .option("--json", "Machine-readable output")
    .addHelpText(
      "after",
      `
A routine fires only on the machine whose identity its runs_on names:
  kraftwerk whoami                      print handle, machine and handle@machine
  kraftwerk whoami --machine studio     rename this machine (the old pair is kept as previous)
  kraftwerk routines adopt              make this machine the runner of every unassigned routine`,
    )
    .action(async (opts: { handle?: string; machine?: string; json?: boolean }) => {
      const before = identityString(await readIdentity());
      for (const label of ["handle", "machine"] as const) {
        const v = opts[label];
        const err = v === undefined ? undefined : identityPartError(label, v);
        if (err) {
          console.error(chalk.red(err));
          process.exit(2);
        }
      }
      const changing = opts.handle !== undefined || opts.machine !== undefined;
      const id = changing ? await setIdentity({ handle: opts.handle, machine: opts.machine }) : await readIdentity();
      const now = identityString(id);
      if (opts.json) return void console.log(JSON.stringify({ handle: id.handle, machine: id.machine, identity: now, previous: id.previous }, null, 2));
      if (changing && before !== now) console.log(`${chalk.green("✔")} ${chalk.dim(before)} → ${chalk.cyan(now)}`);
      console.log(`handle:   ${id.handle}`);
      console.log(`machine:  ${id.machine}`);
      console.log(`identity: ${chalk.cyan(now)}`);
      if (id.previous.length) console.log(chalk.dim(`previous: ${id.previous.join(", ")}`));
      if (changing && before !== now) {
        console.log(chalk.dim(`  routines that name ${before} no longer fire here — \`kraftwerk doctor --fix\` moves them to ${now}`));
      }
    });
}
