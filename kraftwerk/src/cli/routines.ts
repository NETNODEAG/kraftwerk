import { readFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { resolveProject } from "../config.js";
import { setOutputDir, setProjectRoot } from "../inspector/context.js";
import {
  deleteRoutine,
  listRoutines,
  routineStatuses,
  saveRoutine,
  type RoutineStatus,
} from "../inspector/routines.js";
import { getAgent, listAgents } from "../inspector/agents.js";

/**
 * `kraftwerk routines` — CLI surface over per-agent scheduled prompts
 * (agents/<slug>/routines.yml). Definition CRUD works directly on the
 * files; `run` fires through the running inspector server, because the
 * session (chat) and the scheduler live there.
 */

/** Point the inspector context at this project so agent/routine paths resolve. */
export async function initContext(): Promise<{ port: number }> {
  const project = await resolveProject(process.cwd());
  setProjectRoot(project.root);
  setOutputDir(project.outputDir);
  return { port: project.config.port ?? 1981 };
}

async function requireAgent(slug: string): Promise<void> {
  if (!(await getAgent(slug))) {
    console.error(chalk.red(`Agent "${slug}" not found (expected agents/${slug}/agent.yml).`));
    process.exit(2);
  }
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** ISO timestamp → local "YYYY-MM-DD HH:mm" (schedules are server-local time). */
const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function routineLine(r: RoutineStatus): string {
  const state = r.enabled ? chalk.green("on ") : chalk.dim("off");
  const flags = r.lastError ? ` ${chalk.red(`error: ${r.lastError}`)}` : "";
  return (
    `  ${chalk.cyan(r.id.padEnd(24))} ${state} ${r.schedule.padEnd(14)} ` +
    chalk.dim(`next ${fmtTime(r.nextRunAt).padEnd(17)} last ${fmtTime(r.lastRunAt)}`) +
    flags
  );
}

export function registerRoutineCommands(program: Command): void {
  const routines = program
    .command("routines")
    .description("Per-agent scheduled prompts (agents/<slug>/routines.yml): list, add, run, ...");

  routines
    .command("list", { isDefault: true })
    .description("List routines — all agents, or one agent with schedule state")
    .argument("[agent]", "Agent slug (folder under agents/)")
    .option("--json", "Machine-readable output")
    .action(async (agent: string | undefined, opts: { json?: boolean }) => {
      await initContext();
      const slugs = agent ? [agent] : (await listAgents()).map((m) => m.slug);
      if (agent) await requireAgent(agent);
      const all: Record<string, RoutineStatus[]> = {};
      for (const slug of slugs) all[slug] = await routineStatuses(slug);
      if (opts.json) return void console.log(JSON.stringify(all, null, 2));
      let any = false;
      for (const [slug, rs] of Object.entries(all)) {
        if (rs.length === 0) continue;
        any = true;
        console.log(chalk.bold(slug));
        for (const r of rs) console.log(routineLine(r));
      }
      if (!any) {
        console.log(chalk.yellow("No routines yet — add one with `kraftwerk routines add <agent> --name ... --schedule ... --prompt ...`."));
      }
    });

  routines
    .command("add")
    .description("Create or update a routine (same id = update)")
    .argument("<agent>", "Agent slug")
    .requiredOption("--name <name>", 'Display name, e.g. "Morning triage"')
    .requiredOption("--schedule <cron>", '5-field cron ("0 9 * * 1-5") or @hourly/@daily/@weekly/@monthly')
    .option("--prompt <text>", "The prompt to post (or pipe it on stdin / use --file)")
    .option("--file <path>", "Read the prompt from a file")
    .option("--id <id>", "Routine id (default: derived from the name)")
    .option("--disabled", "Create it switched off")
    .action(async (
      agent: string,
      opts: { name: string; schedule: string; prompt?: string; file?: string; id?: string; disabled?: boolean }
    ) => {
      await initContext();
      await requireAgent(agent);
      const prompt =
        opts.prompt ??
        (opts.file ? await readFile(path.resolve(opts.file), "utf8") : process.stdin.isTTY ? "" : await readStdin());
      if (!prompt.trim()) {
        console.error(chalk.red("No prompt (--prompt, --file, or pipe it on stdin)."));
        process.exit(2);
      }
      try {
        const existing = new Set((await listRoutines(agent)).map((r) => r.id));
        const routine = await saveRoutine(agent, {
          ...(opts.id ? { id: opts.id } : {}),
          name: opts.name,
          schedule: opts.schedule,
          prompt,
          enabled: !opts.disabled,
        });
        const verb = existing.has(routine.id) ? "updated" : "created";
        console.log(
          `${chalk.green("✔")} ${verb} ${chalk.cyan(`${agent}/${routine.id}`)} ` +
            chalk.dim(`(${routine.schedule}${routine.enabled ? "" : ", disabled"})`)
        );
        if (routine.enabled) {
          console.log(chalk.dim("  fires from the inspector server — make sure `kraftwerk ui` is running."));
        }
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(2);
      }
    });

  routines
    .command("remove")
    .description("Delete a routine")
    .argument("<agent>", "Agent slug")
    .argument("<id>", "Routine id (see `kraftwerk routines <agent>`)")
    .action(async (agent: string, id: string) => {
      await initContext();
      await requireAgent(agent);
      if (!(await listRoutines(agent)).some((r) => r.id === id)) {
        console.error(chalk.red(`Routine "${agent}/${id}" not found.`));
        process.exit(2);
      }
      await deleteRoutine(agent, id);
      console.log(`${chalk.green("✔")} removed ${chalk.cyan(`${agent}/${id}`)}`);
    });

  for (const [verb, enabled] of [["enable", true], ["disable", false]] as const) {
    routines
      .command(verb)
      .description(`${verb === "enable" ? "Enable" : "Disable"} a routine`)
      .argument("<agent>", "Agent slug")
      .argument("<id>", "Routine id")
      .action(async (agent: string, id: string) => {
        await initContext();
        const routine = (await listRoutines(agent)).find((r) => r.id === id);
        if (!routine) {
          console.error(chalk.red(`Routine "${agent}/${id}" not found.`));
          process.exit(2);
        }
        await saveRoutine(agent, { ...routine, enabled });
        console.log(`${chalk.green("✔")} ${chalk.cyan(`${agent}/${id}`)} ${verb}d`);
      });
  }

  routines
    .command("run")
    .description("Fire a routine now (opens a session via the running `kraftwerk ui` server)")
    .argument("<agent>", "Agent slug")
    .argument("<id>", "Routine id")
    .option("--port <port>", "Inspector port (default: kraftwerk.yml `port`, else 1981)")
    .action(async (agent: string, id: string, opts: { port?: string }) => {
      const { port } = await initContext();
      const p = opts.port ? Number(opts.port) : port;
      const url = `http://localhost:${p}/api/agents/${encodeURIComponent(agent)}/routines/${encodeURIComponent(id)}/run`;
      let body: { chatId?: string; error?: string };
      try {
        body = (await (await fetch(url, { method: "POST" })).json()) as typeof body;
      } catch {
        console.error(chalk.red(`Inspector not reachable on localhost:${p} — routines fire through the server; start it with \`kraftwerk ui\`.`));
        process.exit(2);
      }
      if (body.error || !body.chatId) {
        console.error(chalk.red(body.error ?? "run failed"));
        process.exit(2);
      }
      console.log(
        `${chalk.green("✔")} ${chalk.cyan(`${agent}/${id}`)} fired → session ${body.chatId}\n` +
          chalk.dim(`  http://localhost:${p}/#/agents/${encodeURIComponent(agent)}/chat/${body.chatId}`)
      );
    });
}
