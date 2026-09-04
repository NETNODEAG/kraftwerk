import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { addRepo, listRepos, removeRepo, updateRepo } from "../inspector/repos.js";
import { fmtAgo } from "./projects.js";
import { initContext as prepare } from "./routines.js";

/**
 * `kraftwerk repos` — the git repositories the agents work on, kept under
 * the project's repos root (`repos.root` in kraftwerk.yml). The same module
 * the inspector uses, so a clone made here shows up on the repositories
 * screen and in every agent's context at once:
 *
 *   kraftwerk repos                        list: name, branch, head, state
 *   kraftwerk repos add <url> [--name x] [--branch b] [--depth n]
 *   kraftwerk repos update <name>          fetch, fast-forward when clean
 *   kraftwerk repos remove <name> [--force]
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

export function registerRepoCommands(program: Command): void {
  const repos = program
    .command("repos")
    .description("Repositories the agents work on: list, clone one into the repos root, update, remove");

  repos
    .command("list", { isDefault: true })
    .description("List the clones under the repos root with branch, head and state")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const view = await listRepos();
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (!view.enabled) die(view.error ?? "repositories are off");
      if (view.repos.length === 0) {
        console.log(chalk.dim(`No repositories under ${view.root} yet — \`kraftwerk repos add <url>\` clones one.`));
        return;
      }
      const table = new Table({
        head: ["name", "branch", "head", "state", "url"].map((h) => chalk.bold(h)),
        wordWrap: true,
        colWidths: [22, 16, 30, 18, 40],
      });
      for (const r of view.repos) {
        const state = r.error
          ? chalk.red(r.error)
          : [
              r.dirty ? chalk.yellow(`${r.dirty} changed`) : "",
              r.ahead ? chalk.green(`${r.ahead}↑`) : "",
              r.behind ? chalk.cyan(`${r.behind}↓`) : "",
            ]
              .filter(Boolean)
              .join(" ") || chalk.dim("clean");
        table.push([
          chalk.cyan(r.slug),
          r.branch ?? "—",
          r.head ? `${r.head} ${chalk.dim(r.subject ?? "")}\n${chalk.dim(fmtAgo(r.committedAt))}` : "—",
          state,
          r.url ?? chalk.dim("(no origin)"),
        ]);
      }
      console.log(table.toString());
      console.log(chalk.dim(view.root ?? ""));
    });

  repos
    .command("add")
    .description("Clone a repository into the repos root")
    .argument("<url>", "git url, or github:org/repo")
    .option("--name <name>", "Folder name under the root (default: last url segment)")
    .option("--branch <branch>", "Branch to check out")
    .option("--depth <n>", "Shallow clone with n commits of history (large repositories)")
    .option("--json", "Print the new entry as JSON")
    .action(async (url: string, opts: { name?: string; branch?: string; depth?: string; json?: boolean }) => {
      await prepare();
      try {
        const depth = opts.depth === undefined ? undefined : Number(opts.depth);
        const repo = await addRepo({ url, name: opts.name, branch: opts.branch, depth });
        if (opts.json) console.log(JSON.stringify(repo, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(repo.slug)} → ${repo.path}${repo.branch ? chalk.dim(` (${repo.branch})`) : ""}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  repos
    .command("update")
    .description("Fetch a repository and fast-forward it when it is clean")
    .argument("<name>", "Folder name under the root")
    .action(async (name: string) => {
      await prepare();
      const r = await updateRepo(name).catch((err: Error) => ({ ok: false, error: err.message, repo: undefined }));
      if (!r.ok) die(r.error ?? "update failed");
      const repo = r.repo!;
      const tail = r.error ? chalk.yellow(` — ${r.error}`) : "";
      console.log(`${chalk.green("✔")} ${chalk.cyan(name)} at ${repo.head} ${chalk.dim(repo.subject ?? "")}${tail}`);
    });

  repos
    .command("remove")
    .description("Delete a clone from the repos root (refused while it holds unpushed or uncommitted work)")
    .argument("<name>", "Folder name under the root")
    .option("--force", "Delete even with local changes")
    .action(async (name: string, opts: { force?: boolean }) => {
      await prepare();
      const r = await removeRepo(name, !!opts.force).catch((err: Error) => ({ ok: false, error: err.message }));
      if (!r.ok) die(r.error ?? "remove failed");
      console.log(`${chalk.green("✔")} removed ${chalk.cyan(name)}`);
    });
}
