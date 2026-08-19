import { readFile } from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import ora from "ora";
import { discoverWorkflows, findWorkflowsRoot } from "../discover.js";
import { loadWorkflow, type LoadedWorkflow } from "../yaml.js";
import { renderCreateBrief } from "./create-brief.js";

/**
 * kraftwerk — the nn-agent-framework CLI.
 *
 *   kraftwerk list                    discover + list workflows
 *   kraftwerk run [workflow] [text]   run one (prompts interactively if omitted)
 *   kraftwerk validate [paths...]     validate without executing
 *
 * Workflows are auto-discovered under src/workflows/ (or workflows/) in the
 * current directory — YAML folders and single .yml files. No entry file,
 * no registration: a consumer is package.json + workflow folders.
 */

const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8")
);

const program = new Command()
  .name("kraftwerk")
  .description("nn-agent-framework CLI: YAML-Workflows entdecken, validieren, ausfuehren")
  .version(pkg.version);

const agentLabel = (workflow: LoadedWorkflow): string =>
  workflow.meta.agents
    .map((a) => {
      const harness = a.harness && a.harness !== "claude" ? `${a.harness}:` : "";
      const effort = a.effort ? `, ${a.effort}` : "";
      return `${a.id} ${chalk.dim(`(${harness}${a.model}${effort})`)}`;
    })
    .join("\n");

program
  .command("list")
  .description("Workflows im aktuellen Projekt entdecken und auflisten")
  .action(async () => {
    const spinner = ora("Workflows entdecken ...").start();
    const found = await discoverWorkflows(process.cwd());
    spinner.stop();

    if (found.length === 0) {
      console.log(chalk.yellow("Keine Workflows gefunden (erwartet: src/workflows/ oder workflows/)."));
      return;
    }
    const table = new Table({
      head: ["workflow", "description", "steps", "agents"].map((h) => chalk.bold(h)),
      wordWrap: true,
      colWidths: [16, 40, 7, 36],
    });
    for (const entry of found) {
      if (entry.workflow) {
        table.push([
          chalk.cyan(entry.workflow.name),
          entry.workflow.description,
          String(entry.workflow.meta.steps.length),
          agentLabel(entry.workflow),
        ]);
      } else {
        table.push([
          chalk.red(path.basename(entry.path)),
          chalk.red(entry.error ?? "unbekannter Fehler"),
          "—",
          "—",
        ]);
      }
    }
    console.log(table.toString());
  });

program
  .command("run")
  .description("Einen Workflow ausfuehren (fragt interaktiv nach, was fehlt)")
  .argument("[workflow]", "Workflow-Name aus `kraftwerk list`")
  .argument("[request...]", "Auftrag: Thema, URL, Projektidee, ...")
  .option("--yes", "Approval-Gates automatisch bestaetigen")
  .option("--verbose", "Agent-Narration mitschreiben")
  .option("--sandbox", "Im Docker-Sandbox-Container ausfuehren (Image: kraftwerk-runner)")
  .option("--ssh", "SSH-Agent + known_hosts in die Sandbox weiterreichen (nur mit --sandbox)")
  .option("--run-id <id>", "Run-Ordnername vorgeben (output/<id>), z.B. fuer externe Trigger")
  .action(async (
    name: string | undefined,
    requestParts: string[],
    opts: { yes?: boolean; verbose?: boolean; sandbox?: boolean; ssh?: boolean; runId?: string }
  ) => {
    const spinner = ora("Workflows laden ...").start();
    const found = await discoverWorkflows(process.cwd());
    spinner.stop();

    const valid = found.filter((e) => e.workflow);
    if (valid.length === 0) {
      console.error(chalk.red("Keine gueltigen Workflows gefunden."));
      process.exit(1);
    }

    let entry = name ? valid.find((e) => e.workflow!.name === name) : undefined;
    if (name && !entry) {
      console.error(
        chalk.red(`Workflow "${name}" nicht gefunden.`) +
          ` Vorhanden: ${valid.map((e) => e.workflow!.name).join(", ")}`
      );
      process.exit(1);
    }
    entry ??= await select({
      message: "Welcher Workflow?",
      choices: valid.map((e) => ({
        name: `${e.workflow!.name} — ${e.workflow!.description}`,
        value: e,
      })),
    });
    const workflow = entry.workflow!;

    let request = (requestParts ?? []).join(" ").trim();
    if (!request) request = (await input({ message: "Auftrag (Thema, URL, ...):" })).trim();
    if (!request) {
      console.error(chalk.red("Kein Auftrag angegeben."));
      process.exit(1);
    }

    if (opts.sandbox) {
      const { runSandboxed } = await import("../runner/docker.js");
      const handle = await runSandboxed({
        projectRoot: process.cwd(),
        workflowPath: entry.path,
        workflowName: workflow.name,
        request,
        runId: opts.runId,
        ssh: !!opts.ssh,
        mode: "attach",
      });
      console.log(chalk.dim(`sandbox ${handle.containerName} → ${handle.runDir}`));
      process.exit(await handle.finished);
    }

    if (opts.runId) process.env.KRAFTWERK_RUN_DIR = path.resolve("output", opts.runId);
    await workflow.run({ request, autoApprove: !!opts.yes, verbose: !!opts.verbose });
  });

const runner = program
  .command("runner")
  .description("Docker-Sandbox-Runner verwalten (Image bauen, laufende Runs sehen/stoppen)");

runner
  .command("build")
  .description("kraftwerk-runner Image bauen/aktualisieren")
  .action(async () => {
    const { buildImage, dockerAvailable } = await import("../runner/docker.js");
    if (!dockerAvailable()) {
      console.error(chalk.red("Docker-Daemon nicht erreichbar — laeuft Docker?"));
      process.exit(1);
    }
    await buildImage();
    console.log(chalk.green("✔ Image kraftwerk-runner gebaut"));
  });

runner
  .command("ps")
  .description("Laufende Sandbox-Runs auflisten")
  .action(async () => {
    const { listSandboxes } = await import("../runner/docker.js");
    const rows = listSandboxes();
    if (rows.length === 0) {
      console.log(chalk.dim("Keine laufenden Sandbox-Runs."));
      return;
    }
    for (const r of rows) {
      console.log(`${chalk.cyan(r.runId)}  ${r.workflow}  ${chalk.dim(r.status)}`);
    }
  });

runner
  .command("stop")
  .description("Einen laufenden Sandbox-Run stoppen")
  .argument("<runId>", "Run-Id (run-...)")
  .action(async (runId: string) => {
    const { stopSandbox } = await import("../runner/docker.js");
    if (stopSandbox(runId.replace(/^kw-/, ""))) {
      console.log(chalk.green(`✔ ${runId} gestoppt`));
    } else {
      console.error(chalk.red(`Kein laufender Container fuer ${runId}.`));
      process.exit(1);
    }
  });

// LLM-facing, veloop-style: prints a self-contained brief for the agent
// that then authors the workflow folder with this CLI.
program
  .command("create")
  .description("Brief fuer einen LLM-Agenten drucken, der aus der Beschreibung einen Workflow baut")
  .argument("<spec...>", "was der Workflow tun soll (Freitext)")
  .action(async (specParts: string[]) => {
    const spec = specParts.join(" ").trim();
    if (!spec) {
      console.error(chalk.red('Beschreibung fehlt. Beispiel: kraftwerk create "Ein Workflow, der Release Notes schreibt und reviewt"'));
      process.exit(1);
    }
    const root = await findWorkflowsRoot(process.cwd());
    console.log(
      renderCreateBrief({
        spec,
        workflowsRoot: root ? path.relative(process.cwd(), root) : undefined,
      })
    );
  });

program
  .command("validate")
  .description("Workflows validieren ohne sie auszufuehren (Schema + Semantik + Dateien)")
  .argument("[paths...]", "workflow.yml-Dateien oder Workflow-Ordner; ohne Angabe: alle entdeckten")
  .action(async (paths: string[]) => {
    let targets = paths;
    if (targets.length === 0) {
      const spinner = ora("Workflows entdecken ...").start();
      targets = (await discoverWorkflows(process.cwd())).map((e) => e.path);
      spinner.stop();
      if (targets.length === 0) {
        console.log(chalk.yellow("Keine Workflows gefunden."));
        return;
      }
    }
    let failures = 0;
    for (const target of targets) {
      try {
        const workflow = await loadWorkflow(target);
        console.log(
          `${chalk.green("✔")} ${target} — ${chalk.cyan(workflow.name)} ` +
            chalk.dim(`(${workflow.meta.steps.length} steps, ${workflow.meta.agents.length} agents)`)
        );
      } catch (err) {
        failures += 1;
        console.error(`${chalk.red("✖")} ${target}\n${chalk.red((err as Error).message)}`);
      }
    }
    process.exit(failures > 0 ? 1 : 0);
  });

await program.parseAsync(process.argv);
