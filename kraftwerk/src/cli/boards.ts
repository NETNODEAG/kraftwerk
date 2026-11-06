import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import {
  appendTaskLog,
  assignTask,
  createBoard,
  createTask,
  DEFAULT_BOARD,
  deleteBoard,
  deleteTask,
  ensureDefaultBoard,
  getBoard,
  getTask,
  listAllBoards,
  listBoards,
  moveTask,
  pickTask,
  saveBoard,
  saveTask,
  type BoardDetail,
  type BoardRef,
  type TaskDetail,
  type TaskSummary,
} from "../core/boards.js";
import { taskSessions, type TaskSession } from "../core/board-wake.js";
import { initContext as prepare } from "./routines.js";
import { fmtAgo } from "./workspaces.js";

/**
 * `kraftwerk boards` and `kraftwerk tasks` — the boards (columns of tasks)
 * of a project or of the workspace, and the tasks on them. The same module
 * the inspector uses, so a task created here is on the board at once, and
 * the agent that is assigned is woken by the server. An agent inside a
 * session needs no --as: KRAFTWERK_AGENT names it, KRAFTWERK_ACTOR signs
 * its log lines.
 *
 *   kraftwerk boards [--project <p>] [--all]                   list boards (the workspace's, a project's, every one)
 *   kraftwerk boards show <board> [--project <p>]              columns, rules, the tasks per column
 *   kraftwerk boards create <title> [--project <p>] [--agent]  new board with the default columns
 *   kraftwerk boards set <board> --agent <slug> | --notes-file  change default agent, stale_after, rules
 *   kraftwerk boards remove <board>                            move the board to the trash
 *
 *   kraftwerk tasks [--board <b>] [--project <p>] [--status] [--assignee] [--mine]
 *   kraftwerk tasks show <n>                                   task.md, folder path, files, log
 *   kraftwerk tasks create <title> [--status todo] [--assign <agent>] [--file task.md] [-m]
 *   kraftwerk tasks set <n> [--title] [--due] [--tags] [--refs] [--notes-file]
 *   kraftwerk tasks move <n> <column> [-m "<why>"]
 *   kraftwerk tasks assign <n> <agent> [-m "<hand-over note>"] | --to human
 *   kraftwerk tasks log <n> "<what you did>" [--tail <k>]
 *   kraftwerk tasks pick [--as <agent>] [--column todo]
 *   kraftwerk tasks remove <n>
 *
 * --board defaults to the project's `tasks` board (or the only board); the
 * number alone names a task.
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

/** Who writes: --actor, else the session's KRAFTWERK_ACTOR, else human:user. */
const actorOf = (opt?: string): string => (opt ?? process.env.KRAFTWERK_ACTOR ?? "").trim() || "human:user";
/** Which agent acts: --as, else the session's KRAFTWERK_AGENT. */
const agentOf = (opt?: string): string => (opt ?? process.env.KRAFTWERK_AGENT ?? "").trim();

interface Where {
  board?: string;
  project?: string;
}

/** The board a command means: --board, else the project's default board when it exists, else the only board. */
async function whereOf(w: Where, create = false): Promise<BoardRef> {
  const project = w.project?.trim() || undefined;
  if (w.board) return { ...(project ? { project } : {}), board: w.board.trim() };
  const view = await listBoards(project);
  if (!view.enabled) die(view.error ?? "boards are off");
  if (view.error) die(view.error);
  const dflt = view.boards.find((b) => b.board === DEFAULT_BOARD);
  if (dflt) return { ...(project ? { project } : {}), board: DEFAULT_BOARD };
  if (view.boards.length === 1) return { ...(project ? { project } : {}), board: view.boards[0].board };
  if (create && view.boards.length === 0) return ensureDefaultBoard(project);
  if (view.boards.length === 0) die(`no board ${project ? `in project ${project}` : "in the workspace"} yet — \`kraftwerk boards create "<title>"${project ? ` --project ${project}` : ""}\` makes one`);
  return die(`several boards here (${view.boards.map((b) => b.board).join(", ")}) — say which with --board`);
}

const flags = (ref: BoardRef): string => (ref.project ? `--project ${ref.project} --board ${ref.board}` : `--board ${ref.board}`);

function taskRow(t: TaskSummary): string[] {
  return [
    chalk.cyan(String(t.number)),
    t.configError ? chalk.red(t.configError) : t.title,
    t.status,
    t.assignee ?? chalk.dim("—"),
    t.due ?? chalk.dim("—"),
    chalk.dim(t.lastLog ?? ""),
    chalk.dim(fmtAgo(t.updatedAt)),
  ];
}

function printBoard(b: BoardDetail): void {
  console.log(`${chalk.bold(b.title)} ${chalk.dim(`(${b.project ? `${b.project}/` : ""}${b.board}${b.agent ? `, default agent ${b.agent}` : ""})`)}`);
  if (b.configError) console.log(chalk.red(`board.md: ${b.configError}`));
  if (b.notes.trim()) console.log(b.notes.trim());
  console.log(chalk.dim(b.path));
  for (const c of b.columns) {
    const items = b.items.filter((t) => t.status === c.slug);
    console.log(`\n${chalk.bold(c.label)} ${chalk.dim(`(${items.length}${c.limit ? `/${c.limit}` : ""}${c.review ? ", review" : c.done ? ", done" : ""})`)}`);
    for (const t of items) console.log(`  ${chalk.cyan(String(t.number).padStart(3))}  ${t.title}${t.assignee ? chalk.dim(` · ${t.assignee}`) : ""}${t.due ? chalk.dim(` · due ${t.due}`) : ""}${t.stale ? chalk.yellow(" · stale") : ""}`);
  }
  const lost = b.items.filter((t) => !b.columns.some((c) => c.slug === t.status));
  if (lost.length) {
    console.log(`\n${chalk.bold("no column")}`);
    for (const t of lost) console.log(`  ${chalk.cyan(String(t.number).padStart(3))}  ${t.title} ${chalk.dim(`(status "${t.status}")`)}`);
  }
}

function printTask(t: TaskDetail): void {
  console.log(`${chalk.cyan(String(t.number))} ${chalk.bold(t.title)} ${chalk.dim(`(${t.ref})`)}`);
  console.log(`${t.status}${t.assignee ? ` · ${t.assignee}` : " · unassigned"}${t.due ? ` · due ${t.due}` : ""}${t.tags.length ? ` · ${t.tags.join(", ")}` : ""}${t.stale ? chalk.yellow(" · stale") : ""}`);
  if (t.refs.length) console.log(chalk.dim(`refs: ${t.refs.join(", ")}`));
  console.log(chalk.dim(`folder: ${t.path}`));
  const sessions = (t as TaskDetail & { sessions?: TaskSession[] }).sessions ?? [];
  if (sessions.length) console.log(chalk.dim(`sessions: ${sessions.map((s) => `${s.emoji ? `${s.emoji} ` : ""}${s.name ?? s.agent} ${s.id}${s.busy ? " (working)" : ""}`).join(", ")}`));
  if (t.configError) console.log(chalk.red(`task.md: ${t.configError}`));
  if (t.notes.trim()) console.log(`\n${t.notes.trim()}`);
  console.log(`\n${chalk.bold("files")}${t.fileList.length ? "" : chalk.dim(" (none)")}`);
  for (const f of t.fileList) console.log(`  ${f}`);
  if (t.log.trim()) console.log(`\n${chalk.bold("log")}\n${t.log.trim()}`);
}

export function registerBoardCommands(program: Command): void {
  const boards = program.command("boards").description("Task boards of a project or the workspace: list, show, create, set, remove");

  boards
    .command("list", { isDefault: true })
    .description("List the boards: the workspace's, a project's (--project), or every one (--all)")
    .option("--project <slug>", "A project's boards")
    .option("--all", "Every board of the workspace and its projects")
    .option("--json", "Machine-readable output")
    .action(async (opts: { project?: string; all?: boolean; json?: boolean }) => {
      await prepare();
      const view = opts.all ? { enabled: true, boards: await listAllBoards() } : await listBoards(opts.project);
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (!view.enabled) die(("error" in view && view.error) || "boards are off");
      if ("error" in view && view.error) die(view.error);
      if (view.boards.length === 0) {
        console.log(chalk.dim(`No boards ${opts.project ? `in project ${opts.project}` : opts.all ? "anywhere" : "in the workspace"} yet — \`kraftwerk boards create "<title>"${opts.project ? ` --project ${opts.project}` : ""}\` starts one.`));
        return;
      }
      const table = new Table({ head: ["board", "where", "tasks", "review", "columns", "changed"].map((h) => chalk.bold(h)) });
      for (const b of view.boards) {
        table.push([
          `${chalk.cyan(b.title)}\n${chalk.dim(b.board)}`,
          b.project ? `project ${b.project}` : chalk.dim("workspace"),
          String(b.tasks),
          b.review ? chalk.yellow(String(b.review)) : chalk.dim("0"),
          chalk.dim(b.configError ? chalk.red(b.configError) : b.columns.map((c) => `${c.label} ${b.counts[c.slug] ?? 0}`).join(" · ")),
          chalk.dim(fmtAgo(b.updatedAt)),
        ]);
      }
      console.log(table.toString());
    });

  boards
    .command("show")
    .description("One board: columns, rules, every task per column")
    .argument("<board>", "Board slug")
    .option("--project <slug>", "The project the board belongs to")
    .option("--json", "Machine-readable output")
    .action(async (board: string, opts: { project?: string; json?: boolean }) => {
      await prepare();
      try {
        const b = await getBoard({ ...(opts.project ? { project: opts.project } : {}), board });
        if (!b) die(`no board "${board}"`);
        if (opts.json) console.log(JSON.stringify(b, null, 2));
        else printBoard(b!);
      } catch (err) {
        die((err as Error).message);
      }
    });

  boards
    .command("create")
    .description("Create a board with the default columns (draft, todo, progress, review, done) unless --columns is given")
    .argument("<title>", "Display title; the folder name is derived from it unless --slug is given")
    .option("--project <slug>", "Create it inside this project (projects/<slug>/boards/)")
    .option("--slug <slug>", "Folder name (lowercase, digits, dashes)")
    .option("--columns <list>", "Comma-separated column slugs")
    .option("--agent <slug>", "Default agent: tasks entering todo unassigned go to it")
    .option("--notes <text>", "The board's rules (the body of board.md)")
    .option("--json", "Print the board as JSON")
    .action(async (title: string, opts: { project?: string; slug?: string; columns?: string; agent?: string; notes?: string; json?: boolean }) => {
      await prepare();
      try {
        const b = await createBoard({ project: opts.project, title, slug: opts.slug, columns: opts.columns ? opts.columns.split(",").map((s) => s.trim()).filter(Boolean) : undefined, agent: opts.agent, notes: opts.notes });
        if (opts.json) console.log(JSON.stringify(b, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(b.board)} → ${b.path} ${chalk.dim(`(columns: ${b.columns.map((c) => c.slug).join(", ")})`)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  boards
    .command("set")
    .description("Change a board's title, default agent, stale_after or rules")
    .argument("<board>", "Board slug")
    .option("--project <slug>", "The project the board belongs to")
    .option("--title <text>", "Display title")
    .option("--agent <slug>", 'Default agent; "" clears it')
    .option("--stale-after <duration>", 'Mark a worked task stale after e.g. 12h, 2d; "" for the default (1d)')
    .option("--columns <list>", "Comma-separated column slugs (replaces the list)")
    .option("--notes-file <path>", "Replace the rules with this file's text")
    .option("--json", "Print the board as JSON")
    .action(async (board: string, opts: { project?: string; title?: string; agent?: string; staleAfter?: string; columns?: string; notesFile?: string; json?: boolean }) => {
      await prepare();
      try {
        const input = {
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.agent !== undefined ? { agent: opts.agent || null } : {}),
          ...(opts.staleAfter !== undefined ? { staleAfter: opts.staleAfter || null } : {}),
          ...(opts.columns !== undefined ? { columns: opts.columns.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
          ...(opts.notesFile ? { notes: await readFile(opts.notesFile, "utf8") } : {}),
        };
        if (Object.keys(input).length === 0) die("nothing to set — pass --title, --agent, --stale-after, --columns or --notes-file");
        const b = await saveBoard({ ...(opts.project ? { project: opts.project } : {}), board }, input);
        if (opts.json) console.log(JSON.stringify(b, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(b.board)} saved`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  boards
    .command("remove")
    .description("Move a board, tasks and all, to the trash")
    .argument("<board>", "Board slug")
    .option("--project <slug>", "The project the board belongs to")
    .action(async (board: string, opts: { project?: string }) => {
      await prepare();
      try {
        await deleteBoard({ ...(opts.project ? { project: opts.project } : {}), board });
        console.log(`${chalk.green("✔")} moved ${chalk.cyan(board)} to the trash`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  const tasks = program.command("tasks").description("Tasks on a board: list, show, create, set, move, assign, log, pick, remove");
  const where = (cmd: Command): Command => cmd.option("--board <slug>", "The board (default: the project's `tasks` board, or the only one)").option("--project <slug>", "The project the board belongs to");

  where(tasks.command("list", { isDefault: true }))
    .description("List the tasks of a board, column by column")
    .option("--status <column>", "Only this column")
    .option("--assignee <agent>", 'Only this agent\'s ("" for unassigned)')
    .option("--mine", "Only the tasks of the agent this session runs as (KRAFTWERK_AGENT)")
    .option("--as <agent>", "With --mine: which agent")
    .option("--json", "Machine-readable output")
    .action(async (opts: Where & { status?: string; assignee?: string; mine?: boolean; as?: string; json?: boolean }) => {
      await prepare();
      try {
        const ref = await whereOf(opts);
        const b = await getBoard(ref);
        if (!b) die(`no board "${ref.board}"`);
        const me = opts.mine ? agentOf(opts.as) || die("--mine needs --as <agent> outside an agent session") : undefined;
        const items = b!.items.filter((t) => (opts.status === undefined || t.status === opts.status) && (opts.assignee === undefined || (t.assignee ?? "") === opts.assignee) && (me === undefined || t.assignee === me));
        if (opts.json) {
          console.log(JSON.stringify({ board: ref, columns: b!.columns, items }, null, 2));
          return;
        }
        if (items.length === 0) {
          console.log(chalk.dim(`No tasks on ${b!.title}${opts.status ? ` in ${opts.status}` : ""}.`));
          return;
        }
        const table = new Table({ head: ["#", "task", "column", "assignee", "due", "last", "changed"].map((h) => chalk.bold(h)), wordWrap: true, colWidths: [5, 36, 11, 12, 12, 30, 12] });
        for (const t of items) table.push(taskRow(t));
        console.log(table.toString());
        console.log(chalk.dim(`${b!.title} (${flags(ref)})`));
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("show"))
    .description("One task: fields, markdown, folder path, files and log")
    .argument("<task>", "Task number or folder name")
    .option("--json", "Machine-readable output")
    .action(async (task: string, opts: Where & { json?: boolean }) => {
      await prepare();
      try {
        const found = await getTask(await whereOf(opts), task);
        if (!found) die(`no task "${task}"`);
        const t = { ...found!, sessions: await taskSessions(found!.ref).catch(() => []) };
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else printTask(t);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("create"))
    .description("Create a task (a numbered folder with task.md and log.md); --assign with --status todo wakes the agent")
    .argument("<title>", "The task's title")
    .option("--status <column>", "The column it starts in (default: the first, draft)")
    .option("--assign <agent>", "Assignee (an agent slug)")
    .option("--due <date>", "Due date, 2026-11-20")
    .option("--tags <list>", "Comma-separated tags")
    .option("--refs <list>", "Comma-separated kind:slug references (contact:anna-meier, knowledge:brand-voice)")
    .option("--file <path>", "The task's markdown (what, done-when, notes) from a file")
    .option("--notes <text>", "The task's markdown inline")
    .option("-m, --message <text>", "A first log line")
    .option("--actor <actor>", "Who writes (default: KRAFTWERK_ACTOR, else human:user)")
    .option("--json", "Print the task as JSON")
    .action(async (title: string, opts: Where & { status?: string; assign?: string; due?: string; tags?: string; refs?: string; file?: string; notes?: string; message?: string; actor?: string; json?: boolean }) => {
      await prepare();
      try {
        const ref = await whereOf(opts, true);
        const t = await createTask(ref, {
          title,
          status: opts.status,
          assignee: opts.assign,
          due: opts.due,
          tags: opts.tags,
          refs: opts.refs,
          notes: opts.file ? await readFile(opts.file, "utf8") : opts.notes,
          actor: actorOf(opts.actor),
          message: opts.message,
        });
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(String(t.number))} ${t.title} ${chalk.dim(`(${t.status}${t.assignee ? `, ${t.assignee}` : ""}) → ${t.path}`)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("set"))
    .description("Change a task's title, due date, tags, refs or markdown")
    .argument("<task>", "Task number or folder name")
    .option("--title <text>", "New title (the folder keeps its name)")
    .option("--due <date>", 'Due date; "" clears it')
    .option("--tags <list>", "Comma-separated tags (replaces)")
    .option("--refs <list>", "Comma-separated kind:slug references (replaces)")
    .option("--notes-file <path>", "Replace the markdown with this file's text")
    .option("--actor <actor>", "Who writes")
    .option("--json", "Print the task as JSON")
    .action(async (task: string, opts: Where & { title?: string; due?: string; tags?: string; refs?: string; notesFile?: string; actor?: string; json?: boolean }) => {
      await prepare();
      try {
        const input = {
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.due !== undefined ? { due: opts.due || null } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.refs !== undefined ? { refs: opts.refs } : {}),
          ...(opts.notesFile ? { notes: await readFile(opts.notesFile, "utf8") } : {}),
        };
        if (Object.keys(input).length === 0) die("nothing to set — pass --title, --due, --tags, --refs or --notes-file");
        const t = await saveTask(await whereOf(opts), task, input, { actor: actorOf(opts.actor) });
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(String(t.number))} ${t.title} saved`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("move"))
    .description("Put a task into a column; the move is logged with -m, and an assigned agent entering a work column is woken")
    .argument("<task>", "Task number or folder name")
    .argument("<column>", "Column slug")
    .option("-m, --message <text>", "Why, for the log")
    .option("--actor <actor>", "Who writes")
    .option("--json", "Print the task as JSON")
    .action(async (task: string, column: string, opts: Where & { message?: string; actor?: string; json?: boolean }) => {
      await prepare();
      try {
        const t = await moveTask(await whereOf(opts), task, column, { message: opts.message, actor: actorOf(opts.actor) });
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(String(t.number))} ${t.title} → ${t.status}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("assign"))
    .description('Hand a task to an agent (woken when the task is in a work column), or back to the humans with "human" (unassigned, into review)')
    .argument("<task>", "Task number or folder name")
    .argument("[agent]", 'Agent slug, or "human"; omit with --to')
    .option("--to <agent>", 'Same as the argument: an agent slug or "human"')
    .option("-m, --message <text>", "The hand-over note, for the log and the next agent")
    .option("--actor <actor>", "Who writes")
    .option("--json", "Print the task as JSON")
    .action(async (task: string, agent: string | undefined, opts: Where & { to?: string; message?: string; actor?: string; json?: boolean }) => {
      await prepare();
      const to = (opts.to ?? agent ?? "").trim();
      if (!to) die('say who: `tasks assign <n> <agent>` or `--to human`');
      try {
        const t = await assignTask(await whereOf(opts), task, to === "human" ? null : to, { message: opts.message, actor: actorOf(opts.actor) });
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else console.log(`${chalk.green("✔")} ${chalk.cyan(String(t.number))} ${t.title} → ${t.assignee ?? `humans (${t.status})`}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("log"))
    .description("Append a stamped line to the task's log (what you did, a question, a decision), or print the last lines with --tail")
    .argument("<task>", "Task number or folder name")
    .argument("[entry]", "The line to record")
    .option("--file <path>", "Read the entry from a file")
    .option("--tail <n>", "Print the newest n lines instead of writing")
    .option("--actor <actor>", "Who writes (default: KRAFTWERK_ACTOR, else human:user)")
    .action(async (task: string, entry: string | undefined, opts: Where & { file?: string; tail?: string; actor?: string }) => {
      await prepare();
      try {
        const ref = await whereOf(opts);
        if (opts.tail !== undefined) {
          const t = await getTask(ref, task);
          if (!t) die(`no task "${task}"`);
          const n = Number(opts.tail) || 5;
          console.log(
            t!.log
              .split("\n")
              .filter((l) => l.startsWith("* ") || l.startsWith("## "))
              .slice(0, n * 2)
              .join("\n"),
          );
          return;
        }
        const text = opts.file ? await readFile(opts.file, "utf8") : entry ?? "";
        const t = await appendTaskLog(ref, task, text, actorOf(opts.actor));
        console.log(`${chalk.green("✔")} logged on ${chalk.cyan(String(t.number))} ${chalk.dim(`(${actorOf(opts.actor)})`)}`);
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("pick"))
    .description("Take the next task of the pick column (todo): it becomes yours and moves to the work column; prints nothing and exits 3 when there is none")
    .option("--as <agent>", "Which agent picks (default: KRAFTWERK_AGENT)")
    .option("--column <slug>", "Pick from this column instead of todo")
    .option("--json", "Print the task as JSON")
    .action(async (opts: Where & { as?: string; column?: string; json?: boolean }) => {
      await prepare();
      const agent = agentOf(opts.as);
      if (!agent) die("who picks? pass --as <agent> (inside an agent session KRAFTWERK_AGENT is set)");
      try {
        const t = await pickTask(await whereOf(opts), agent, { column: opts.column, actor: process.env.KRAFTWERK_ACTOR || agent });
        if (!t) {
          if (opts.json) console.log("null");
          else console.log(chalk.dim("nothing to pick"));
          process.exit(3);
        }
        if (opts.json) console.log(JSON.stringify(t, null, 2));
        else {
          console.log(`${chalk.green("✔")} picked ${chalk.cyan(String(t!.number))} ${t!.title} → ${t!.status}`);
          printTask(t!);
        }
      } catch (err) {
        die((err as Error).message);
      }
    });

  where(tasks.command("remove"))
    .description("Move a task folder, files and log included, to the trash")
    .argument("<task>", "Task number or folder name")
    .action(async (task: string, opts: Where) => {
      await prepare();
      try {
        await deleteTask(await whereOf(opts), task);
        console.log(`${chalk.green("✔")} moved task ${chalk.cyan(task)} to the trash`);
      } catch (err) {
        die((err as Error).message);
      }
    });
}
