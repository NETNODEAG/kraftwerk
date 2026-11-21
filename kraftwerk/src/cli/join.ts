import chalk from "chalk";
import type { Command } from "commander";
import { findDaemon } from "../core/daemon.js";
import { tildify } from "../core/instances.js";
import { openBrowser } from "./cloud.js";
import { startDaemon } from "./daemon-control.js";

/**
 * `kraftwerk join <link> [folder]` — start on the platform. The link comes
 * from kraftwerk cloud: "New workspace" or "Install on a machine" on a
 * workspace's page, or an invite once it is accepted. One command:
 *
 *   npm i -g @netnodeag/kraftwerk && kraftwerk join https://…/join/XKQ7-2MPD-HH3A
 *
 * starts the daemon if it does not run, links this machine to the account
 * of the link, clones the workspace from kraftwerk sync into ./<name> (or
 * <folder>) and opens it in the browser. The daemon does the work
 * (server/join.ts); it brings the machine's key to git, nothing is stored.
 */

interface Joined {
  workspace: { id: string; name: string; slug: string; url: string };
  signin?: string;
  root: string;
  role: string;
  account: string;
  cloned: boolean;
  error?: string;
}

const fail = (message: string, code = 1): never => {
  console.error(chalk.red(`✖ ${message}`));
  process.exit(code);
};

export function registerJoinCommand(program: Command): void {
  program
    .command("join")
    .description("Bring a workspace from kraftwerk cloud onto this machine: the link from the platform (new workspace, install, accepted invite) — clones it into ./<name> and opens it")
    .argument("<link>", "the join link (https://…/join/XXXX-XXXX-XXXX) or its code")
    .argument("[folder]", "where the workspace goes (default: ./<its name>)")
    .option("--no-open", "Do not open the browser")
    .option("--json", "Machine-readable output")
    .action(async (link: string, folder: string | undefined, opts: { open: boolean; json?: boolean }) => {
      if (!(await findDaemon())) {
        if (!opts.json) console.log(chalk.dim("kraftwerk runs as a daemon on this machine — starting it"));
        await startDaemon({});
      }
      const daemon = (await findDaemon()) ?? fail("the daemon did not come up — `kraftwerk daemon logs`");
      if (!opts.json) process.stdout.write(chalk.dim("joining through kraftwerk cloud …"));
      const r = await fetch(`http://127.0.0.1:${daemon.port}/api/cloud/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link, cwd: process.cwd(), ...(folder ? { dir: folder } : {}) }),
        signal: AbortSignal.timeout(10 * 60_000),
      }).catch((err: Error) => fail(`the daemon did not answer: ${err.message}`));
      if (!opts.json) process.stdout.write("\n");
      const data = (await r.json().catch(() => ({}))) as Joined;
      if (!r.ok) fail(data.error ?? `${r.status} from the daemon`);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`${chalk.green("✔")} ${chalk.bold(data.workspace.name)} ${chalk.dim(`(${data.workspace.id}, ${data.role})`)} is on this machine`);
      console.log(`  ${chalk.dim("folder")}   ${tildify(data.root)}${data.cloned ? "" : chalk.dim(" (was already here)")}`);
      console.log(`  ${chalk.dim("account")}  ${data.account} — this machine is linked to it`);
      console.log(`  ${chalk.dim("sync")}     kraftwerk sync: what changes here goes to the cloud every minute, the others' changes come in`);
      console.log(`  ${chalk.dim("open")}     ${chalk.cyan(data.workspace.url)}`);
      if (opts.open) openBrowser(data.signin ?? data.workspace.url);
      else if (data.signin) console.log(`  ${chalk.dim("sign in")}  ${data.signin} ${chalk.dim("(once, within 5 minutes)")}`);
    });
}
