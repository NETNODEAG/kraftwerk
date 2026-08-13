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
  .action(async (name: string | undefined, requestParts: string[], opts: { yes?: boolean; verbose?: boolean }) => {
    const spinner = ora("Workflows laden ...").start();
    const found = await discoverWorkflows(process.cwd());
    spinner.stop();

    const valid = found.filter((e) => e.workflow);
    if (valid.length === 0) {
      console.error(chalk.red("Keine gueltigen Workflows gefunden."));
      process.exit(1);
    }

    let workflow = name ? valid.find((e) => e.workflow!.name === name)?.workflow : undefined;
    if (name && !workflow) {
      console.error(
        chalk.red(`Workflow "${name}" nicht gefunden.`) +
          ` Vorhanden: ${valid.map((e) => e.workflow!.name).join(", ")}`
      );
      process.exit(1);
    }
    workflow ??= await select({
      message: "Welcher Workflow?",
      choices: valid.map((e) => ({
        name: `${e.workflow!.name} — ${e.workflow!.description}`,
        value: e.workflow!,
      })),
    });

    let request = (requestParts ?? []).join(" ").trim();
    if (!request) request = (await input({ message: "Auftrag (Thema, URL, ...):" })).trim();
    if (!request) {
      console.error(chalk.red("Kein Auftrag angegeben."));
      process.exit(1);
    }

    await workflow.run({ request, autoApprove: !!opts.yes, verbose: !!opts.verbose });
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
