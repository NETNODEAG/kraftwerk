import { readFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { resolveProject } from "../config.js";
import {
  fsck,
  getConcept,
  initBundle,
  knowledgeRoot,
  listBundles,
  listConcepts,
  searchKnowledge,
  validateBundle,
  verifyConcept,
  writeConcept,
  type ConceptInfo,
  type ValidationIssue,
} from "../okf.js";

/**
 * `kraftwerk knowledge` — the CLI surface over OKF bundles (Context &
 * Knowledge). This is the enforced write path: `put` stamps provenance
 * (`generated: { by, at }`), appends the bundle log, and regenerates
 * index.md; direct file edits are healed by `fsck --fix`.
 *
 * Agents identify via --actor (or KRAFTWERK_ACTOR); the OKF convention is
 * `<producer>/<version>` for agents, `human:<id>` for people,
 * `process:<id>` for automation. Humans default to `human:user`.
 */

const DEFAULT_ACTOR = "human:user";

const actorOf = (opts: { actor?: string }): string =>
  opts.actor?.trim() || process.env.KRAFTWERK_ACTOR?.trim() || DEFAULT_ACTOR;

async function root(): Promise<string> {
  const project = await resolveProject(process.cwd());
  return knowledgeRoot(project.root, project.config.knowledge);
}

/** Split "bundle/path/to/concept" into its bundle and concept id. */
function splitRef(ref: string): { bundle: string; id: string } {
  const clean = ref.replace(/^\/+/, "");
  const slash = clean.indexOf("/");
  if (slash <= 0 || slash === clean.length - 1) {
    throw new Error(`expected <bundle>/<concept-path>, got "${ref}"`);
  }
  return { bundle: clean.slice(0, slash), id: clean.slice(slash + 1) };
}

const tierColor = (tier: string): string =>
  tier === "human-reviewed"
    ? chalk.green(tier)
    : tier === "machine-confirmed"
      ? chalk.cyan(tier)
      : chalk.dim(tier);

function conceptLine(c: ConceptInfo): string {
  const flags = [
    c.status !== "stable" ? chalk.yellow(c.status) : "",
    c.stale ? chalk.red("stale") : "",
    c.error ? chalk.red("invalid") : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    `  ${chalk.cyan(c.id.padEnd(32))} ${(c.type ?? "?").padEnd(22)} ` +
    `${tierColor(c.trustTier).padEnd(18)} ${flags}`
  );
}

function printIssues(issues: ValidationIssue[]): void {
  for (const i of issues) {
    const mark = i.level === "error" ? chalk.red("✖") : chalk.yellow("⚠");
    console.log(`${mark} ${i.bundle}/${i.file}: ${i.message}`);
  }
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export function registerKnowledgeCommands(program: Command): void {
  const knowledge = program
    .command("knowledge")
    .description("Context & Knowledge: OKF bundles under knowledge/ (read, write, verify)");

  knowledge
    .command("list", { isDefault: true })
    .description("List bundles, or the concepts of one bundle")
    .argument("[bundle]", "Bundle name (a directory under knowledge/)")
    .option("--json", "Machine-readable output")
    .action(async (bundle: string | undefined, opts: { json?: boolean }) => {
      const kroot = await root();
      if (!bundle) {
        const bundles = await listBundles(kroot);
        if (opts.json) return void console.log(JSON.stringify({ root: kroot, bundles }, null, 2));
        if (bundles.length === 0) {
          console.log(chalk.yellow(`No knowledge bundles in ${kroot} — create one with \`kraftwerk knowledge init <name>\`.`));
          return;
        }
        for (const b of bundles) {
          console.log(
            `${chalk.cyan(b.name.padEnd(24))} ${String(b.concepts).padStart(3)} concepts` +
              chalk.dim(`${b.okfVersion ? `  okf ${b.okfVersion}` : ""}${b.updatedAt ? `  updated ${b.updatedAt.slice(0, 10)}` : ""}`)
          );
        }
        return;
      }
      const concepts = await listConcepts(kroot, bundle);
      if (opts.json) return void console.log(JSON.stringify({ bundle, concepts }, null, 2));
      if (concepts.length === 0) {
        console.log(chalk.yellow(`Bundle "${bundle}" has no concepts.`));
        return;
      }
      console.log(chalk.bold(`  ${"concept".padEnd(32)} ${"type".padEnd(22)} trust`));
      for (const c of concepts) console.log(conceptLine(c));
    });

  knowledge
    .command("get")
    .description("Print one concept (raw markdown; --json adds parsed frontmatter + trust)")
    .argument("<ref>", "<bundle>/<concept-path>, e.g. finance/metrics/revenue")
    .option("--json", "Machine-readable output")
    .action(async (ref: string, opts: { json?: boolean }) => {
      const { bundle, id } = splitRef(ref);
      const concept = await getConcept(await root(), bundle, id);
      if (!concept) {
        console.error(chalk.red(`Concept ${ref} not found.`));
        process.exit(2);
      }
      if (opts.json) {
        const { raw, ...rest } = concept;
        console.log(JSON.stringify(rest, null, 2));
      } else {
        process.stdout.write(concept.raw);
      }
    });

  knowledge
    .command("put")
    .description("Write a concept from stdin or --file (stamps generated.by/at, logs, reindexes)")
    .argument("<ref>", "<bundle>/<concept-path>")
    .option("--file <path>", "Read the concept markdown from a file instead of stdin")
    .option("--actor <actor>", `Who writes: <producer>/<version>, human:<id>, process:<id> (default: ${DEFAULT_ACTOR})`)
    .action(async (ref: string, opts: { file?: string; actor?: string }) => {
      const { bundle, id } = splitRef(ref);
      const content = opts.file ? await readFile(path.resolve(opts.file), "utf8") : await readStdin();
      if (!content.trim()) {
        console.error(chalk.red("No content (pipe markdown on stdin or pass --file)."));
        process.exit(2);
      }
      try {
        const result = await writeConcept(await root(), bundle, id, content, actorOf(opts));
        console.log(
          `${chalk.green("✔")} ${result.created ? "created" : "updated"} ${chalk.cyan(`${bundle}/${result.concept.id}`)} ` +
            chalk.dim(`(${result.concept.type}, by ${actorOf(opts)})`)
        );
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(2);
      }
    });

  knowledge
    .command("verify")
    .description("Record a verification event on a concept (raises its trust tier)")
    .argument("<ref>", "<bundle>/<concept-path>")
    .option("--by <actor>", `Verifier actor (default: ${DEFAULT_ACTOR})`)
    .action(async (ref: string, opts: { by?: string }) => {
      const { bundle, id } = splitRef(ref);
      const actor = opts.by?.trim() || process.env.KRAFTWERK_ACTOR?.trim() || DEFAULT_ACTOR;
      try {
        const concept = await verifyConcept(await root(), bundle, id, actor);
        console.log(`${chalk.green("✔")} ${ref} verified by ${actor} → ${tierColor(concept.trustTier)}`);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(2);
      }
    });

  knowledge
    .command("search")
    .description("Full-text search across bundles")
    .argument("<query>", "Search text (case-insensitive substring)")
    .option("--bundle <name>", "Restrict to one bundle")
    .option("--json", "Machine-readable output")
    .action(async (query: string, opts: { bundle?: string; json?: boolean }) => {
      const hits = await searchKnowledge(await root(), query, opts.bundle);
      if (opts.json) return void console.log(JSON.stringify({ query, hits }, null, 2));
      if (hits.length === 0) return void console.log(chalk.dim("No matches."));
      for (const h of hits) {
        console.log(`${chalk.cyan(`${h.bundle}/${h.id}`)} ${chalk.dim(`(${h.type ?? "?"})`)}\n  ${h.snippet}`);
      }
    });

  knowledge
    .command("init")
    .description("Create an empty bundle (index.md + log.md)")
    .argument("<bundle>", "Bundle name")
    .action(async (bundle: string) => {
      try {
        const dir = await initBundle(await root(), bundle);
        console.log(`${chalk.green("✔")} bundle ${chalk.cyan(bundle)} created at ${dir}`);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(2);
      }
    });

  knowledge
    .command("validate")
    .description("OKF conformance check (errors) + provenance/staleness warnings")
    .argument("[bundle]", "Bundle name; without it: all bundles")
    .action(async (bundle: string | undefined) => {
      const kroot = await root();
      const bundles = bundle ? [bundle] : (await listBundles(kroot)).map((b) => b.name);
      let errors = 0;
      for (const b of bundles) {
        const issues = await validateBundle(kroot, b);
        printIssues(issues);
        errors += issues.filter((i) => i.level === "error").length;
      }
      if (errors === 0) console.log(chalk.green(`✔ ${bundles.length} bundle(s) conformant`));
      process.exit(errors > 0 ? 1 : 0);
    });

  knowledge
    .command("fsck")
    .description("Validate all bundles; --fix regenerates every derived index.md")
    .option("--fix", "Regenerate index.md files (heals out-of-band writes)")
    .action(async (opts: { fix?: boolean }) => {
      const issues = await fsck(await root(), !!opts.fix);
      printIssues(issues);
      if (opts.fix) console.log(chalk.green("✔ indexes regenerated"));
      process.exit(issues.some((i) => i.level === "error") ? 1 : 0);
    });
}
