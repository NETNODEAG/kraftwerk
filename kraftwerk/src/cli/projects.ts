import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import {
  appendProjectLog,
  createProject,
  deleteProject,
  getProject,
  linkProject,
  listProjects,
  LINK_KINDS,
  recordLine,
  saveProject,
  type ProjectDetail,
} from "../inspector/projects.js";
import { initContext as prepare } from "./routines.js";
import { fmtAgo } from "./workspaces.js";

/**
 * `kraftwerk projects` — the goal-scoped folders under the projects root
 * (`projects.root` in kraftwerk.yml): a brief, the systems of record, and
 * links to knowledge, vibeables, repositories, workflows and agents. The
 * same module the inspector uses, so a project created here shows up in
 * the UI at once, and an agent in a project chat uses `log` and `link`
 * to keep the project current:
 *
 *   kraftwerk projects                              list: title, status, goal, links
 *   kraftwerk projects create <title> [--goal ..]   new folder from the starter (project.yml, brief, state, log); --harness/--model/--effort
 *   kraftwerk projects set <slug> [--harness ..]    change harness, model, effort, status or goal
 *   kraftwerk projects show <slug>                  definition, links (found / missing), records, state, log
 *   kraftwerk projects link <slug> <kind> <name>    add a knowledge|vibeables|repos|workflows|agents link
 *   kraftwerk projects unlink <slug> <kind> <name>  remove one
 *   kraftwerk projects log <slug> "<entry>"         append a stamped line to log.md (--actor)
 *   kraftwerk projects remove <slug>                delete the folder (its history stays in the workspace git)
 *
 * The workspace registry answered to this name until 0.48; it is
 * `kraftwerk workspaces` now (workspaces.ts).
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

const linkSummary = (p: { knowledge: string[]; vibeables: string[]; repos: string[]; workflows: string[]; agents: string[] }): string =>
  LINK_KINDS.map((k) => (p[k].length ? `${p[k].length} ${k}` : ""))
    .filter(Boolean)
    .join(", ");

function printDetail(p: ProjectDetail): void {
  console.log(`${chalk.bold(p.title)} ${chalk.dim(`(${p.slug}, ${p.status})`)}`);
  console.log(p.goal ? p.goal : chalk.dim("(no goal yet)"));
  console.log(chalk.dim(`runs on ${p.harness}${p.model ? ` · ${p.model}` : ""}${p.effort ? ` · effort ${p.effort}` : ""}`));
  console.log(chalk.dim(p.path));
  if (p.configError) console.log(chalk.red(`project.yml: ${p.configError}`));
  if (p.records.length) {
    console.log(`\n${chalk.bold("systems of record")}`);
    for (const r of p.records) console.log(recordLine(r));
  }
  for (const kind of LINK_KINDS) {
    if (!p.links[kind].length) continue;
    console.log(`\n${chalk.bold(kind)}`);
    for (const l of p.links[kind]) {
      console.log(l.found ? `  ${chalk.green("✔")} ${l.slug}${l.label ? chalk.dim(`  ${l.label}`) : ""}` : `  ${chalk.yellow("?")} ${l.slug} ${chalk.dim("(not found)")}`);
    }
  }
  if (p.state.trim()) console.log(`\n${chalk.bold("state.md")}\n${p.state.trim()}`);
  if (p.log.trim()) console.log(`\n${chalk.bold("log.md")}\n${p.log.trim()}`);
}

export function registerProjectCommands(program: Command): void {
  const projects = program
    .command("projects")
    .description("Projects: a goal with its brief, systems of record and links, worked on in chat — list, create, link, log");

  projects
    .command("list", { isDefault: true })
    .description("List the projects under the projects root")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const view = await listProjects();
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (!view.enabled) die(view.error ?? "projects are off");
      if (view.projects.length === 0) {
        console.log(chalk.dim(`No projects under ${view.root} yet — \`kraftwerk projects create "<title>"\` starts one.`));
        return;
      }
      const table = new Table({
        head: ["project", "status", "goal", "links", "changed"].map((h) => chalk.bold(h)),
        wordWrap: true,
        colWidths: [26, 10, 40, 24, 14],
      });
      for (const p of view.projects) {
        table.push([
          `${chalk.cyan(p.title)}\n${chalk.dim(p.slug)}`,
          p.status === "active" ? chalk.green(p.status) : chalk.dim(p.status),
          p.configError ? chalk.red(p.configError) : p.goal || chalk.dim("—"),
          chalk.dim(linkSummary(p) || "—"),
          chalk.dim(fmtAgo(p.updatedAt)),
        ]);
      }
      console.log(table.toString());
      console.log(chalk.dim(view.root ?? ""));
    });

  projects
    .command("create")
    .description("Create a project folder from the starter (project.yml, brief.md, state.md, log.md)")
    .argument("<title>", "Display title; the folder name is derived from it unless --slug is given")
    .option("--goal <text>", "One-line goal")
    .option("--slug <slug>", "Folder name under the root (lowercase, digits, dashes)")
    .option("--harness <harness>", "Harness every chat in the project runs on: claude | codex | pi (default: claude)")
    .option("--model <model>", "Model for that harness (default: the harness default)")
    .option("--effort <effort>", "Reasoning effort: low | medium | high | xhigh | max")
    .option("--json", "Print the new project as JSON")
    .action(async (title: string, opts: { goal?: string; slug?: string; harness?: string; model?: string; effort?: string; json?: boolean }) => {
      await prepare();
      try {
        const p = await createProject({ title, goal: opts.goal, slug: opts.slug, harness: opts.harness, model: opts.model, effort: opts.effort });
        if (opts.json) console.log(JSON.stringify(p, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(p.slug)} → ${p.path} ${chalk.dim("(open it on the Projects screen, or `kraftwerk projects show " + p.slug + "`)")}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  projects
    .command("show")
    .description("Show one project: definition, records, links with their state, state.md and log.md")
    .argument("<slug>", "Folder name under the root")
    .option("--json", "Machine-readable output")
    .action(async (slug: string, opts: { json?: boolean }) => {
      await prepare();
      try {
        const p = await getProject(slug);
        if (!p) die(`no project "${slug}"`);
        if (opts.json) console.log(JSON.stringify(p, null, 2));
        else printDetail(p!);
      } catch (err) {
        die((err as Error).message);
      }
    });

  projects
    .command("set")
    .description("Change the project's harness, model, effort, status or goal (like an agent's settings)")
    .argument("<slug>", "Project folder name")
    .option("--harness <harness>", "claude | codex | pi")
    .option("--model <model>", 'Model for the harness; "" for the default')
    .option("--effort <effort>", 'low | medium | high | xhigh | max; "" for the default')
    .option("--status <status>", "active | paused | done | archived")
    .option("--goal <text>", "One-line goal")
    .option("--json", "Print the project as JSON")
    .action(async (slug: string, opts: { harness?: string; model?: string; effort?: string; status?: string; goal?: string; json?: boolean }) => {
      await prepare();
      const { json: asJson, ...fields } = opts;
      if (Object.values(fields).every((v) => v === undefined)) die("nothing to set — pass --harness, --model, --effort, --status or --goal");
      try {
        const p = await saveProject(slug, fields);
        if (asJson) console.log(JSON.stringify(p, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(p.slug)} runs on ${p.harness}${p.model ? ` · ${p.model}` : ""}${p.effort ? ` · effort ${p.effort}` : ""} ${chalk.dim(`(${p.status})`)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  for (const verb of ["link", "unlink"] as const) {
    projects
      .command(verb)
      .description(verb === "link" ? "Add a linked knowledge bundle, vibeable, repository, workflow or agent" : "Remove a link")
      .argument("<slug>", "Project folder name")
      .argument("<kind>", `One of ${LINK_KINDS.join(", ")}`)
      .argument("<name>", "The target's name (bundle, folder, workflow or agent slug)")
      .option("--json", "Print the project as JSON")
      .action(async (slug: string, kind: string, name: string, opts: { json?: boolean }) => {
        await prepare();
        try {
          const p = await linkProject(slug, kind, name, verb === "unlink");
          if (opts.json) console.log(JSON.stringify(p, null, 2));
          else {
            const state = p.links[kind as (typeof LINK_KINDS)[number]]?.find((l) => l.slug === name);
            const note = verb === "link" && state && !state.found ? chalk.yellow(" (not found in this workspace yet)") : "";
            console.log(`${chalk.green("✔")} ${verb === "link" ? "linked" : "unlinked"} ${kind} ${chalk.cyan(name)} ${verb === "link" ? "to" : "from"} ${p.slug}${note}`);
          }
        } catch (err) {
          die((err as Error).message);
        }
      });
  }

  projects
    .command("log")
    .description("Append a dated, attributed line to the project's log.md (newest first)")
    .argument("<slug>", "Project folder name")
    .argument("[entry]", "The line to record; omit with --file")
    .option("--file <path>", "Read the entry from a file")
    .option("--actor <actor>", "Who writes: human:<id>, <agent>/<harness>, process:<id>", "human:user")
    .action(async (slug: string, entry: string | undefined, opts: { file?: string; actor: string }) => {
      await prepare();
      try {
        const text = opts.file ? await readFile(opts.file, "utf8") : entry ?? "";
        await appendProjectLog(slug, text, opts.actor);
        console.log(`${chalk.green("✔")} logged to ${chalk.cyan(slug)} ${chalk.dim(`(${opts.actor})`)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  projects
    .command("remove")
    .description("Delete a project folder; its history stays in the workspace git")
    .argument("<slug>", "Folder name under the root")
    .action(async (slug: string) => {
      await prepare();
      try {
        await deleteProject(slug);
        console.log(`${chalk.green("✔")} removed ${chalk.cyan(slug)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });
}
