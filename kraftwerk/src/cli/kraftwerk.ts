import { readFile } from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import ora from "ora";
import { discoverWorkflows, findWorkflowsRoot } from "../discover.js";
import { isRemoteSpec, resolveRemote } from "../remote.js";
import { loadWorkflow, missingEnv, type LoadedWorkflow } from "../yaml.js";
import { renderCreateBrief } from "./create-brief.js";
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { listRuns, showRun } from "./runs.js";

/**
 * kraftwerk — the kraftwerk CLI.
 *
 *   kraftwerk init                    scaffold kraftwerk.yml + workflows/ + example
 *   kraftwerk list                    discover + list workflows (--json, --from)
 *   kraftwerk run [workflow] [text]   run one (prompts interactively if omitted)
 *   kraftwerk runs [show <id>]        inspect past runs from their traces
 *   kraftwerk doctor                  preflight: harness CLIs, docker, workflows, env
 *   kraftwerk validate [paths...]     validate without executing
 *
 * Workflows are auto-discovered under src/workflows/ (or workflows/), from
 * any subdirectory (walk-up to kraftwerk.yml / workflows root / .git). No
 * entry file, no registration, no local install needed — a repo with
 * workflow folders plus `npx kraftwerk` is a complete consumer.
 *
 * Machine use (CI, cron, webhooks): `run --json` prints one JSON result on
 * stdout and moves all narration to stderr; KRAFTWERK_YES=1 = --yes.
 * Exit codes: 0 ok, 2 usage/config error, 3 run failed, 1 unexpected.
 *
 * `--from github:org/repo[@ref]` on list/run executes workflows straight
 * from a git remote (shallow clone cache in ~/.cache/kraftwerk).
 */

/** Working directory for list/run: local cwd or the --from remote clone. */
async function resolveBaseDir(from?: string): Promise<string> {
  if (!from) return process.cwd();
  if (!isRemoteSpec(from)) {
    console.error(chalk.red(`--from "${from}" not recognized — expected github:org/repo[@ref] or a git URL.`));
    process.exit(2);
  }
  return (await resolveRemote(from)).dir;
}

const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8")
);

const program = new Command()
  .name("kraftwerk")
  .description("kraftwerk CLI: discover, validate, and run YAML workflows")
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
  .description("Discover and list the workflows in the current project")
  .option("--json", "Machine-readable output (JSON on stdout)")
  .option("--from <source>", "Workflows from a git remote: github:org/repo[@ref] or git URL")
  .action(async (opts: { json?: boolean; from?: string }) => {
    const baseDir = await resolveBaseDir(opts.from);
    const spinner = opts.json ? undefined : ora("Discovering workflows ...").start();
    const found = await discoverWorkflows(baseDir);
    spinner?.stop();

    if (opts.json) {
      console.log(
        JSON.stringify(
          found.map((e) => ({
            path: e.path,
            name: e.workflow?.name,
            description: e.workflow?.description,
            steps: e.workflow?.meta.steps,
            requires: e.workflow?.meta.requires,
            agents: e.workflow?.meta.agents.map((a) => ({
              id: a.id,
              model: a.model,
              harness: a.harness ?? "claude",
            })),
            error: e.error,
          })),
          null,
          2
        )
      );
      return;
    }
    if (found.length === 0) {
      console.log(chalk.yellow("No workflows found (expected: src/workflows/ or workflows/ — `kraftwerk init` scaffolds a project)."));
      return;
    }
    const table = new Table({
      head: ["workflow", "description", "steps", "agents"].map((h) => chalk.bold(h)),
      wordWrap: true,
      colWidths: [16, 40, 7, 36],
    });
    for (const entry of found) {
      if (entry.workflow) {
        const requires = entry.workflow.meta.requires;
        table.push([
          chalk.cyan(entry.workflow.name),
          entry.workflow.description +
            (requires.length ? chalk.dim(`\nrequires: ${requires.join(", ")}`) : ""),
          String(entry.workflow.meta.steps.length),
          agentLabel(entry.workflow),
        ]);
      } else {
        table.push([
          chalk.red(path.basename(entry.path)),
          chalk.red(entry.error ?? "unknown error"),
          "—",
          "—",
        ]);
      }
    }
    console.log(table.toString());
  });

program
  .command("run")
  .description("Run a workflow (prompts interactively for anything missing)")
  .argument("[workflow]", "Workflow name from `kraftwerk list`")
  .argument("[request...]", "The request: topic, URL, project idea, ...")
  .option("--yes", "Auto-confirm approval gates (also: KRAFTWERK_YES=1)")
  .option("--verbose", "Stream the agent narration")
  .option("--json", "Non-interactive: JSON result on stdout, narration on stderr")
  .option("--quiet", "Suppress narration (result/errors only)")
  .option("--from <source>", "Workflows from a git remote: github:org/repo[@ref] or git URL")
  .option("--sandbox", "Run inside the Docker sandbox container (image: kraftwerk-runner)")
  .option("--ssh", "Forward the SSH agent + known_hosts into the sandbox (only with --sandbox)")
  .option("--run-id <id>", "Pin the run folder name (output/<id>), e.g. for external triggers")
  .action(async (
    name: string | undefined,
    requestParts: string[],
    opts: {
      yes?: boolean;
      verbose?: boolean;
      json?: boolean;
      quiet?: boolean;
      from?: string;
      sandbox?: boolean;
      ssh?: boolean;
      runId?: string;
    }
  ) => {
    const machine = !!opts.json;
    const fail = (code: number, message: string): never => {
      if (machine) console.log(JSON.stringify({ ok: false, error: message }));
      console.error(chalk.red(message));
      process.exit(code);
    };

    const baseDir = await resolveBaseDir(opts.from);
    const spinner = machine ? undefined : ora("Loading workflows ...").start();
    const found = await discoverWorkflows(baseDir);
    spinner?.stop();

    const valid = found.filter((e) => e.workflow);
    if (valid.length === 0) fail(2, "No valid workflows found.");

    let entry = name ? valid.find((e) => e.workflow!.name === name) : undefined;
    if (name && !entry) {
      fail(
        2,
        `Workflow "${name}" not found. Available: ${valid.map((e) => e.workflow!.name).join(", ")}`
      );
    }
    if (!entry && machine) fail(2, "No workflow given (--json is non-interactive).");
    entry ??= await select({
      message: "Which workflow?",
      choices: valid.map((e) => ({
        name: `${e.workflow!.name} — ${e.workflow!.description}`,
        value: e,
      })),
    });
    const workflow = entry.workflow!;

    let request = (requestParts ?? []).join(" ").trim();
    if (!request && machine) fail(2, "No request given (--json is non-interactive).");
    if (!request) request = (await input({ message: "Request (topic, URL, ...):" })).trim();
    if (!request) fail(2, "No request given.");

    const missing = missingEnv(workflow.meta.requires);
    if (missing.length > 0) {
      fail(2, `Workflow "${workflow.name}" needs environment variables that are missing: ${missing.join(", ")}`);
    }

    if (opts.sandbox) {
      const { runSandboxed } = await import("../runner/docker.js");
      const handle = await runSandboxed({
        projectRoot: baseDir,
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

    if (opts.runId) {
      process.env.KRAFTWERK_RUN_DIR = path.resolve("output", opts.runId);
    } else if (!process.env.KRAFTWERK_RUN_DIR) {
      // Root the run dir explicitly: at the project's output dir (honors
      // kraftwerk.yml `output:` and works from subdirs); for remote runs at
      // the caller's cwd — never inside the clone cache.
      const { runStamp } = await import("../workflow.js");
      const { resolveProject } = await import("../config.js");
      const outBase = opts.from ? path.resolve("output") : (await resolveProject(baseDir)).outputDir;
      process.env.KRAFTWERK_RUN_DIR = path.join(outBase, `run-${runStamp()}`);
    }

    // Machine/quiet mode: workflow narration must not pollute stdout — the
    // engine logs via console.log, so reroute it for the duration of the run.
    const realLog = console.log;
    if (machine) console.log = (...args: unknown[]) => console.error(...args);
    else if (opts.quiet) console.log = () => {};

    const autoApprove = !!opts.yes || process.env.KRAFTWERK_YES === "1";
    try {
      const result = await workflow.run({ request, autoApprove, verbose: !!opts.verbose });
      console.log = realLog;
      if (machine) {
        console.log(JSON.stringify({ ok: true, workflow: workflow.name, request, ...result }, null, 2));
      } else if (opts.quiet && result) {
        console.log(`ok ${workflow.name} → ${result.runDir}`);
      }
    } catch (err) {
      console.log = realLog;
      const message = (err as Error).message;
      if (machine) console.log(JSON.stringify({ ok: false, workflow: workflow.name, request, error: message }));
      console.error(chalk.red(message));
      process.exit(3);
    }
  });

program
  .command("init")
  .description("Scaffold the project: kraftwerk.yml, workflows/ with an example, .gitignore")
  .action(async () => {
    await runInit(process.cwd());
  });

program
  .command("doctor")
  .description("Preflight: harness CLIs, docker, workflows, declared environment variables")
  .action(async () => {
    await runDoctor(process.cwd());
  });

const runs = program
  .command("runs")
  .description("Inspect past runs (from output/*/trace.jsonl)");

runs
  .command("list", { isDefault: true })
  .description("List runs (newest first)")
  .option("--json", "Machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    await listRuns(process.cwd(), opts);
  });

runs
  .command("show")
  .description("Show one run in detail: phases, gates, cost")
  .argument("<runId>", "Folder name under output/, see `kraftwerk runs`")
  .option("--json", "Machine-readable output (all trace events)")
  .action(async (runId: string, opts: { json?: boolean }) => {
    await showRun(process.cwd(), runId, opts);
  });

const runner = program
  .command("runner")
  .description("Manage the Docker sandbox runner (build the image, see/stop running runs)");

runner
  .command("build")
  .description("Build/update the kraftwerk-runner image")
  .action(async () => {
    const { buildImage, dockerAvailable } = await import("../runner/docker.js");
    if (!dockerAvailable()) {
      console.error(chalk.red("Docker daemon not reachable — is Docker running?"));
      process.exit(1);
    }
    await buildImage();
    console.log(chalk.green("✔ Image kraftwerk-runner built"));
  });

runner
  .command("ps")
  .description("List running sandbox runs")
  .action(async () => {
    const { listSandboxes } = await import("../runner/docker.js");
    const rows = listSandboxes();
    if (rows.length === 0) {
      console.log(chalk.dim("No running sandbox runs."));
      return;
    }
    for (const r of rows) {
      console.log(`${chalk.cyan(r.runId)}  ${r.workflow}  ${chalk.dim(r.status)}`);
    }
  });

runner
  .command("stop")
  .description("Stop a running sandbox run")
  .argument("<runId>", "Run-Id (run-...)")
  .action(async (runId: string) => {
    const { stopSandbox } = await import("../runner/docker.js");
    if (stopSandbox(runId.replace(/^kw-/, ""))) {
      console.log(chalk.green(`✔ ${runId} stopped`));
    } else {
      console.error(chalk.red(`No running container for ${runId}.`));
      process.exit(1);
    }
  });

// LLM-facing, veloop-style: prints a self-contained brief for the agent
// that then authors the workflow folder with this CLI.
program
  .command("create")
  .description("Print a brief for an LLM agent that builds a workflow from the description")
  .argument("<spec...>", "What the workflow should do (free text)")
  .action(async (specParts: string[]) => {
    const spec = specParts.join(" ").trim();
    if (!spec) {
      console.error(chalk.red('Description missing. Example: kraftwerk create "A workflow that writes and reviews release notes"'));
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
  .description("Validate workflows without executing them (schema + semantics + files)")
  .argument("[paths...]", "workflow.yml files or workflow folders; without paths: all discovered")
  .action(async (paths: string[]) => {
    let targets = paths;
    if (targets.length === 0) {
      const spinner = ora("Discovering workflows ...").start();
      targets = (await discoverWorkflows(process.cwd())).map((e) => e.path);
      spinner.stop();
      if (targets.length === 0) {
        console.log(chalk.yellow("No workflows found."));
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
