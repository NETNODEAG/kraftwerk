import chalk from "chalk";
import type { Command } from "commander";
import { resolveWorkspace, workspaceSlug } from "../config.js";
import { findDaemon } from "../core/daemon.js";

/**
 * `kraftwerk invite` — invite someone into this workspace as a remote
 * member: they join in the cloud with the code (or the link) and reach the
 * workspace through this machine's relay, without a clone (see
 * server/members.ts). The running daemon asks the cloud on the machine's
 * behalf (POST /api/cloud/invite), so the machine must be claimed
 * (`kraftwerk login`) and the workspace must have its id (ws_…) and be open
 * in the daemon.
 *
 *   kraftwerk invite                       from a workspace folder: a member invite
 *   kraftwerk invite --role owner          an owner invite
 *   kraftwerk invite --workspace <slug>    a workspace the daemon serves, from anywhere
 */

interface InviteAnswer {
  code: string;
  url: string;
  role: string;
  expiresAt: string;
  workspace: { id: string; slug: string; name: string };
  error?: string;
}

const fail = (message: string, code = 1): never => {
  console.error(chalk.red(`✖ ${message}`));
  process.exit(code);
};

export function registerInviteCommand(program: Command): void {
  program
    .command("invite")
    .description("Invite someone into this workspace as a remote member (no clone): prints the join code and link — the machine must be claimed (`kraftwerk login`)")
    .option("--role <role>", "member (default) or owner")
    .option("--workspace <slug>", "A workspace the daemon serves, instead of the one in this folder")
    .option("--json", "Machine-readable output")
    .action(async (opts: { role?: string; workspace?: string; json?: boolean }) => {
      if (opts.role !== undefined && opts.role !== "owner" && opts.role !== "member") fail("--role is member or owner", 2);
      let which: { slug?: string; root?: string };
      if (opts.workspace) which = { slug: opts.workspace };
      else {
        const ws = await resolveWorkspace(process.cwd()).catch((err: Error) => fail(err.message));
        if (!ws.configPath) fail("not in a workspace folder (no kraftwerk.yml here or above) — run it there, or pass --workspace <slug>", 2);
        if (!ws.config.id) fail("this workspace has no id (ws_…) in kraftwerk.yml — run `kraftwerk doctor --fix`");
        which = { root: ws.root, slug: workspaceSlug(ws) };
      }
      const daemon = await findDaemon();
      if (!daemon) fail("the daemon is not running — `kraftwerk daemon start` (it holds this machine's place in the cloud)");
      const r = await fetch(`http://127.0.0.1:${daemon!.port}/api/cloud/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...which, ...(opts.role ? { role: opts.role } : {}) }),
        signal: AbortSignal.timeout(20_000),
      }).catch((err: Error) => fail(`the daemon did not answer: ${err.message}`));
      const data = (await r.json().catch(() => ({}))) as InviteAnswer;
      if (!r.ok) fail(data.error ?? `${r.status} from the daemon`);
      if (opts.json) return void console.log(JSON.stringify(data, null, 2));
      console.log(`${chalk.green("✔")} invite to ${chalk.bold(data.workspace.name)} ${chalk.dim(`(${data.workspace.slug}, ${data.workspace.id})`)} as ${data.role}`);
      console.log(`  code        ${chalk.bold(data.code)}`);
      console.log(`  join link   ${chalk.cyan(data.url)}`);
      console.log(chalk.dim(`  valid until ${new Date(data.expiresAt).toLocaleString()} — they join in the cloud and reach the workspace through this machine`));
    });
}
