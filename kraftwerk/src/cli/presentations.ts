import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import {
  createDeck,
  deleteDeck,
  exportDeck,
  getDeck,
  addComment,
  listComments,
  updateComment,
  initTemplate,
  listAllDecks,
  listDecks,
  listTemplates,
  type ExportFormat,
  type PresentationDetail,
  type PresentationRef,
  type RenderWarning,
} from "../core/presentations/index.js";
import { initContext as prepare } from "./routines.js";
import { fmtAgo } from "./workspaces.js";

/**
 * kraftwerk presentations [list] [--project <slug>] [--all] [--json]
 * kraftwerk presentations show <name> [--project <slug>] [--json]       the slides, the template's layouts and slots, the warnings
 * kraftwerk presentations create "<title>" [--project <slug>] [--slug <s>] [--template <t>] [--from <deck.md>]
 * kraftwerk presentations check <name> [--project <slug>]               warnings; exits 1 on errors
 * kraftwerk presentations render <name> --pptx|--pdf|--png|--html [--out <dir>] [--width <px>] [--project <slug>]
 * kraftwerk presentations comments <name> [--all] | comment <name> <slide> "<text>" [--slot <box>] | resolve <name> <id> [--reply "<text>"]
 * kraftwerk presentations remove <name> [--project <slug>]
 * kraftwerk presentations templates [--json]; templates init <slug>     the templates; a copy of the built-in one to edit
 *
 * Agents write deck.md directly (show prints the folder) and look at the
 * PNGs `render --png` writes. The CLI talks to core, not to the server.
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

const refOf = (name: string, project?: string): PresentationRef => ({ ...(project?.trim() ? { project: project.trim() } : {}), name: name.trim() });

const printWarnings = (warnings: RenderWarning[]): void => {
  for (const w of warnings) {
    const where = `${w.slide ? `slide ${w.slide}` : "deck"}${w.slot ? ` · ${w.slot}` : ""}`;
    console.log(`${w.level === "error" ? chalk.red("error") : chalk.yellow("warn ")}  ${chalk.dim(where)}  ${w.message}`);
  }
};

function printDeck(d: PresentationDetail): void {
  console.log(`${chalk.bold(d.title)} ${chalk.dim(`(${d.project ? `${d.project}/` : ""}${d.name}, template ${d.template}, ${d.slides} slides)`)}`);
  console.log(chalk.dim(`folder: ${d.path}`));
  if (d.error) console.log(chalk.red(`deck.md: ${d.error}`));
  console.log(`\n${chalk.bold("slides")}`);
  d.deck.slides.forEach((s, i) => {
    const first = s.content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? "";
    console.log(`  ${chalk.cyan(String(i + 1).padStart(3))}  ${chalk.dim(`[${s.layout ?? "default"}]`)} ${first}${s.notes ? chalk.dim(" · notes") : ""}`);
  });
  console.log(`\n${chalk.bold("layouts")} ${chalk.dim(`of template ${d.template}`)}`);
  for (const l of d.layouts) console.log(`  ${chalk.cyan(l.name.padEnd(12))} ${l.slots.map((s) => `${s.name}${s.required ? "*" : ""}:${s.kind}`).join(" ")}${l.description ? chalk.dim(`  ${l.description}`) : ""}`);
  if (d.theme.snippets.length) console.log(`\n${chalk.bold("pieces")} ${chalk.dim(`of the theme (HTML for a slot; \`presentations show --json\` has the markup)`)}\n${d.theme.snippets.map((x) => `  ${chalk.cyan(x.name.padEnd(14))} ${chalk.dim(x.description ?? "")}`).join("\n")}`);
  if (d.assets.length) console.log(`\n${chalk.bold("assets")}\n${d.assets.map((a) => `  ${a}`).join("\n")}`);
  if (d.exports.length) console.log(`\n${chalk.bold("exports")}\n${d.exports.map((a) => `  exports/${a}`).join("\n")}`);
  console.log(`\n${chalk.bold("warnings")}${d.warnings.length ? "" : chalk.dim(" (none)")}`);
  printWarnings(d.warnings);
}

export function registerPresentationCommands(program: Command): void {
  const cmd = program.command("presentations").alias("decks").description("Slide decks of a project or the workspace: list, show, create, check, render, remove, templates");

  cmd
    .command("list", { isDefault: true })
    .description("List the decks: the workspace's, a project's (--project), or every one (--all)")
    .option("--project <slug>", "A project's decks")
    .option("--all", "Every deck of the workspace and its projects")
    .option("--json", "Machine-readable output")
    .action(async (opts: { project?: string; all?: boolean; json?: boolean }) => {
      await prepare();
      const view = opts.all ? { enabled: true, presentations: await listAllDecks() } : await listDecks(opts.project);
      if (opts.json) {
        console.log(JSON.stringify(view, null, 2));
        return;
      }
      if (!view.enabled) die(("error" in view && view.error) || "presentations are off");
      if ("error" in view && view.error) die(view.error);
      if (view.presentations.length === 0) {
        console.log(chalk.dim(`No presentations ${opts.project ? `in project ${opts.project}` : opts.all ? "anywhere" : "in the workspace"} yet — \`kraftwerk presentations create "<title>"${opts.project ? ` --project ${opts.project}` : ""}\` starts one.`));
        return;
      }
      const table = new Table({ head: ["deck", "where", "slides", "template", "changed"].map((h) => chalk.bold(h)) });
      for (const p of view.presentations) {
        table.push([`${chalk.cyan(p.title)}\n${chalk.dim(p.name)}`, p.project ? `project ${p.project}` : chalk.dim("workspace"), p.error ? chalk.red(p.error) : String(p.slides), p.template, chalk.dim(fmtAgo(p.updatedAt))]);
      }
      console.log(table.toString());
    });

  cmd
    .command("show")
    .description("One deck: its slides, the template's layouts and slots, the warnings")
    .argument("<name>", "Deck name")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--json", "Machine-readable output")
    .action(async (name: string, opts: { project?: string; json?: boolean }) => {
      await prepare();
      const d = await getDeck(refOf(name, opts.project)).catch((err: Error) => die(err.message));
      if (!d) return die(`no presentation "${name}"`);
      if (opts.json) console.log(JSON.stringify(d, null, 2));
      else printDeck(d);
    });

  cmd
    .command("create")
    .description("Create a deck: a starter deck.md, or one from a markdown file (--from)")
    .argument("<title>", "Deck title")
    .option("--project <slug>", "Create it in a project")
    .option("--slug <name>", "Folder name (default: from the title)")
    .option("--template <slug>", "Template (default: default)")
    .option("--from <file>", "A deck.md to start from")
    .option("--json", "Machine-readable output")
    .action(async (title: string, opts: { project?: string; slug?: string; template?: string; from?: string; json?: boolean }) => {
      await prepare();
      const source = opts.from ? await readFile(opts.from, "utf8").catch(() => die(`cannot read ${opts.from}`)) : undefined;
      const d = await createDeck({ ...(opts.project ? { project: opts.project } : {}), title, ...(opts.slug ? { slug: opts.slug } : {}), ...(opts.template ? { template: opts.template } : {}), ...(source ? { source } : {}) }).catch((err: Error) => die(err.message));
      if (opts.json) {
        console.log(JSON.stringify(d, null, 2));
        return;
      }
      console.log(`${chalk.green("created")} ${chalk.bold(d.title)} ${chalk.dim(`(${d.project ? `${d.project}/` : ""}${d.name})`)}`);
      console.log(chalk.dim(`write ${d.path}/deck.md, pictures into ${d.path}/assets/`));
      printWarnings(d.warnings);
    });

  cmd
    .command("check")
    .description("Check a deck against its template: every warning; exits 1 when there are errors")
    .argument("<name>", "Deck name")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--json", "Machine-readable output")
    .action(async (name: string, opts: { project?: string; json?: boolean }) => {
      await prepare();
      const d = await getDeck(refOf(name, opts.project)).catch((err: Error) => die(err.message));
      if (!d) return die(`no presentation "${name}"`);
      if (opts.json) console.log(JSON.stringify({ name: d.name, project: d.project, slides: d.slides, warnings: d.warnings }, null, 2));
      else if (d.warnings.length === 0) console.log(`${chalk.green("ok")} ${d.slides} slides, no warnings`);
      else printWarnings(d.warnings);
      if (d.warnings.some((w) => w.level === "error")) process.exit(1);
    });

  cmd
    .command("render")
    .description("Write the deck as PPTX, PDF, slide PNGs or one HTML file into its exports/ folder (or --out)")
    .argument("<name>", "Deck name")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--pptx", "PowerPoint file")
    .option("--pdf", "PDF, one page per slide")
    .option("--png", "One PNG per slide (exports/slides/NN.png) — look at them")
    .option("--html", "One self-contained HTML file: present it in any browser, print it to PDF")
    .option("--out <dir>", "Write there instead of exports/")
    .option("--width <px>", "Image width for --png and --pdf (default 1280 / 1600)")
    .option("--json", "Machine-readable output")
    .action(async (name: string, opts: { project?: string; pptx?: boolean; pdf?: boolean; png?: boolean; html?: boolean; out?: string; width?: string; json?: boolean }) => {
      await prepare();
      const formats = (["pptx", "pdf", "png", "html"] as ExportFormat[]).filter((f) => opts[f]);
      if (formats.length === 0) die("say what to write: --pptx, --pdf, --png and/or --html");
      const width = opts.width ? Number(opts.width) : undefined;
      if (width !== undefined && !(width >= 160 && width <= 3840)) die("--width must be between 160 and 3840");
      const files: string[] = [];
      let warnings: RenderWarning[] = [];
      for (const format of formats) {
        const r = await exportDeck(refOf(name, opts.project), format, { ...(opts.out ? { outDir: opts.out } : {}), ...(width ? { width } : {}) }).catch((err: Error) => die(err.message));
        files.push(...r.files);
        warnings = r.warnings;
      }
      if (opts.json) {
        console.log(JSON.stringify({ files, warnings }, null, 2));
        return;
      }
      for (const f of files) console.log(`${chalk.green("wrote")} ${f}`);
      printWarnings(warnings);
    });

  /** Who writes: the session's actor (an agent), else human:user. */
  const actor = (): string => (process.env.KRAFTWERK_ACTOR ?? "").trim() || "human:user";

  cmd
    .command("comments")
    .description("The comments on a deck's slides and boxes: the open ones, or --all")
    .argument("<name>", "Deck name")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--all", "Resolved ones too")
    .option("--json", "Machine-readable output")
    .action(async (name: string, opts: { project?: string; all?: boolean; json?: boolean }) => {
      await prepare();
      const all = await listComments(refOf(name, opts.project)).catch((err: Error) => die(err.message));
      const shown = opts.all ? all : all.filter((c) => !c.resolved);
      if (opts.json) {
        console.log(JSON.stringify({ comments: shown }, null, 2));
        return;
      }
      if (!shown.length) {
        console.log(chalk.dim(opts.all ? "no comments" : "no open comments"));
        return;
      }
      for (const c of shown) {
        console.log(`${chalk.cyan(c.id)} ${chalk.dim(`slide ${c.n ?? "?"}${c.slot ? ` · ${c.slot}` : ""} · ${c.author} · ${c.at.slice(0, 16).replace("T", " ")}${c.resolved ? " · resolved" : ""}`)}\n  ${c.text}`);
        for (const r of c.replies) console.log(`  ${chalk.dim(`↳ ${r.author}:`)} ${r.text}`);
      }
    });

  cmd
    .command("comment")
    .description("Comment on slide n of a deck, or on one of its boxes (--slot)")
    .argument("<name>", "Deck name")
    .argument("<slide>", "Slide number")
    .argument("<text>", "The comment")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--slot <box>", "The box it is about")
    .action(async (name: string, slide: string, text: string, opts: { project?: string; slot?: string }) => {
      await prepare();
      const c = await addComment(refOf(name, opts.project), { slide: Number(slide), text, author: actor(), ...(opts.slot ? { slot: opts.slot } : {}) }).catch((err: Error) => die(err.message));
      console.log(`${chalk.green("commented")} ${c.id} on slide ${c.n}`);
    });

  cmd
    .command("resolve")
    .description("Resolve a comment, answering it with --reply")
    .argument("<name>", "Deck name")
    .argument("<id>", "Comment id (from `presentations comments`)")
    .option("--project <slug>", "The project the deck belongs to")
    .option("--reply <text>", "What was done about it")
    .option("--reopen", "Open it again instead")
    .action(async (name: string, id: string, opts: { project?: string; reply?: string; reopen?: boolean }) => {
      await prepare();
      await updateComment(refOf(name, opts.project), id, { resolved: !opts.reopen, author: actor(), ...(opts.reply ? { reply: opts.reply } : {}) }).catch((err: Error) => die(err.message));
      console.log(`${chalk.green(opts.reopen ? "reopened" : "resolved")} ${id}`);
    });

  cmd
    .command("remove")
    .description("Move a deck to the trash")
    .argument("<name>", "Deck name")
    .option("--project <slug>", "The project the deck belongs to")
    .action(async (name: string, opts: { project?: string }) => {
      await prepare();
      await deleteDeck(refOf(name, opts.project)).catch((err: Error) => die(err.message));
      console.log(`${chalk.green("removed")} ${name} ${chalk.dim("(in the trash)")}`);
    });

  const templates = cmd.command("templates").description("The templates: the built-in one and the workspace's (templates/<slug>/template.yml under the presentations root)");
  templates
    .command("list", { isDefault: true })
    .description("List the templates with their layouts")
    .option("--json", "Machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await prepare();
      const list = await listTemplates();
      if (opts.json) {
        console.log(JSON.stringify({ templates: list }, null, 2));
        return;
      }
      for (const t of list) console.log(`${chalk.cyan(t.slug.padEnd(14))} ${t.error ? chalk.red(t.error) : `${t.name} ${chalk.dim(`(${t.size}; layouts: ${t.layouts.join(", ")})`)}`}${t.builtin ? chalk.dim("  built-in") : t.path ? chalk.dim(`  ${t.path}`) : ""}`);
    });
  templates
    .command("init")
    .description("Write a copy of the built-in template as a workspace template to edit")
    .argument("<slug>", "Template name")
    .action(async (slug: string) => {
      await prepare();
      const file = await initTemplate(slug).catch((err: Error) => die(err.message));
      console.log(`${chalk.green("wrote")} ${file}`);
    });
}
