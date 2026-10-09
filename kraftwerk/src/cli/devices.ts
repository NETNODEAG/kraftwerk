import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { createPairCode, listDevices, PAIR_CODE_TTL_MS, revokeDevice } from "../core/devices.js";
import { fmtAgo } from "./workspaces.js";

/**
 * `kraftwerk devices` — other machines (a phone, a second laptop, an app)
 * that may use this machine's kraftwerk. One pairing covers every
 * workspace here; the store is ~/.kraftwerk/devices.json.
 *
 *   kraftwerk devices                list paired devices
 *   kraftwerk devices pair           a one-time code to pair one (10 minutes)
 *   kraftwerk devices revoke <id>    unpair one: its token stops working at once
 *
 * A device reaches this machine when the UI listens on the network:
 * `kraftwerk ui --lan` (or through a tunnel, see `kraftwerk tunnel`).
 */
export function registerDevicesCommands(program: Command): void {
  const devices = program.command("devices").description("Paired devices: list, pair one, revoke one");

  devices
    .command("list", { isDefault: true })
    .description("List paired devices")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const list = await listDevices();
      if (opts.json) return void console.log(JSON.stringify(list, null, 2));
      if (list.length === 0) return void console.log(chalk.dim("No paired devices. `kraftwerk devices pair` makes a code for one."));
      const table = new Table({ head: ["id", "name", "paired", "last seen"].map((h) => chalk.bold(h)) });
      for (const d of list) table.push([chalk.cyan(d.id), d.name, chalk.dim(fmtAgo(d.createdAt)), chalk.dim(d.lastSeenAt ? fmtAgo(d.lastSeenAt) : "never")]);
      console.log(table.toString());
    });

  devices
    .command("pair")
    .description(`A one-time pairing code, valid ${PAIR_CODE_TTL_MS / 60_000} minutes`)
    .action(async () => {
      const { code } = await createPairCode();
      console.log(`${chalk.green("✔")} pairing code ${chalk.bold.cyan(code)} ${chalk.dim(`— valid ${PAIR_CODE_TTL_MS / 60_000} minutes, once`)}`);
      console.log(
        chalk.dim(
          "Open kraftwerk on the device (start the UI with `kraftwerk ui --lan` to reach it on your network) and enter the code.",
        ),
      );
    });

  devices
    .command("revoke")
    .description("Unpair a device: its token stops working at once")
    .argument("<id>", "Device id as `kraftwerk devices` lists it")
    .action(async (id: string) => {
      if (!(await revokeDevice(id))) {
        console.error(chalk.red(`No paired device "${id}".`));
        process.exit(1);
      }
      console.log(`${chalk.green("✔")} unpaired ${chalk.cyan(id)}`);
    });
}
