import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { CONTACTS, createEntity, deleteEntity, EVENTS, getEntity, listEntities, PLACES, saveEntity, type EntityBase, type EntityDetail, type EntityInput, type EntityKindDef } from "../core/entities.js";
import { recordLine } from "../core/records.js";
import { findRefs, resolveRef, resolveTokens, type ResolvedRef } from "../core/refs.js";
import { initContext as prepare } from "./routines.js";
import { fmtAgo } from "./workspaces.js";

/**
 * `kraftwerk contacts|places|events` — the workspace's records of who,
 * where and when, one Markdown file each (core/entities.ts). One command
 * group per kind, built from the kind's definition so the options are its
 * fields; the same module the inspector uses, so an entry created here
 * shows up in the UI at once, and an agent uses these to keep them current:
 *
 *   kraftwerk contacts                                   list (--json)
 *   kraftwerk contacts show <slug>                       fields, records, links (found / missing), notes
 *   kraftwerk contacts create <title> [--org ..] [--email ..] [--place <slug>] [--tags a,b] [--notes ..]
 *   kraftwerk contacts set <slug> [--role ..] [--notes-file <md>]   change fields; "" clears one
 *   kraftwerk contacts remove <slug>                     move the file to the trash
 *   kraftwerk places ...                                 --address, --lat, --lng, --url; show prints the Google Maps link
 *   kraftwerk events [--from <date>] [--to <date>]       --start (required), --end, --place, --contacts a,b, --project
 *   kraftwerk ref <kind:slug> | --file <md>              resolve references (exit 1 when a target is missing)
 */

const die = (msg: string): never => {
  console.error(chalk.red(msg));
  process.exit(1);
};

const mark = (found: boolean): string => (found ? chalk.green("✔") : chalk.yellow("?"));

function printDetail(def: EntityKindDef<any>, e: EntityDetail<EntityBase>): void {
  const rec = e as unknown as Record<string, unknown>;
  console.log(`${chalk.bold(e.title)} ${chalk.dim(`(${def.singular}:${e.slug})`)}`);
  console.log(chalk.dim(e.path));
  if (e.configError) console.log(chalk.red(`frontmatter: ${e.configError}`));
  for (const f of def.fields) {
    const v = rec[f.name];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    const links = e.links[f.name];
    const shown = links ? links.map((l) => `${mark(l.found)} ${l.slug}${l.label ? chalk.dim(`  ${l.label}`) : l.found ? "" : chalk.dim(" (not found)")}`).join(", ") : Array.isArray(v) ? v.join(", ") : String(v);
    console.log(`${chalk.dim(f.label.padEnd(12))} ${shown}`);
  }
  if (def.kind === "places" && rec.mapsUrl) console.log(`${chalk.dim("map".padEnd(12))} ${rec.mapsUrl}`);
  if (e.tags.length) console.log(`${chalk.dim("tags".padEnd(12))} ${e.tags.join(", ")}`);
  for (const [k, v] of Object.entries(e.extra ?? {})) console.log(`${chalk.dim(k.padEnd(12))} ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (e.records.length) {
    console.log(`\n${chalk.bold("systems of record")}`);
    for (const r of e.records) console.log(recordLine(r));
  }
  if (e.notes.trim()) console.log(`\n${chalk.bold("notes")}\n${e.notes.trim()}`);
}

/** The fields given on the command line, as the store takes them (comma lists split there; "" clears). */
function fieldsOf(def: EntityKindDef<any>, opts: Record<string, unknown>): EntityInput {
  const out: EntityInput = {};
  for (const f of def.fields) if (opts[f.name] !== undefined) out[f.name] = opts[f.name];
  if (opts.tags !== undefined) out.tags = opts.tags;
  if (opts.title !== undefined) out.title = opts.title as string;
  return out;
}

export function registerEntityCommands(program: Command, def: EntityKindDef<any>): void {
  const what = { contacts: "people and organisations", places: "addresses and points of interest", events: "dated one-off entries" }[def.kind];
  const group = program.command(def.kind).description(`${def.kind[0].toUpperCase()}${def.kind.slice(1)}: ${what}, one Markdown file each — list, show, create, set, remove`);
  const withFields = (cmd: Command): Command => {
    for (const f of def.fields) cmd.option(`--${f.name} <value>`, `${f.hint}${f.required ? " (required)" : ""}`);
    cmd.option("--tags <list>", "Tags, comma-separated");
    return cmd;
  };

  const list = group
    .command("list", { isDefault: true })
    .description(`List the ${def.kind} under the ${def.kind} root`)
    .option("--json", "Machine-readable output");
  if (def.span) list.option("--from <date>", "Only entries still running on or after this date (ISO)").option("--to <date>", "Only entries that have started by this date (ISO)");
  list.action(async (opts: { json?: boolean; from?: string; to?: string }) => {
    await prepare();
    const view = await listEntities(def, { from: opts.from, to: opts.to });
    if (opts.json) {
      console.log(JSON.stringify(view, null, 2));
      return;
    }
    if (!view.enabled) die(view.error ?? `${def.kind} are off`);
    if (view.items.length === 0) {
      console.log(chalk.dim(`No ${def.kind} under ${view.root} yet — \`kraftwerk ${def.kind} create "<title>"\` adds one.`));
      return;
    }
    const table = new Table({ head: [def.singular, "details", "changed"].map((h) => chalk.bold(h)), wordWrap: true, colWidths: [30, 56, 14] });
    for (const e of view.items) {
      table.push([`${chalk.cyan(e.title)}\n${chalk.dim(e.slug)}`, e.configError ? chalk.red(e.configError) : def.detail(e) || chalk.dim("—"), chalk.dim(fmtAgo(e.updatedAt))]);
    }
    console.log(table.toString());
    console.log(chalk.dim(view.root ?? ""));
  });

  group
    .command("show")
    .description(`Show one ${def.singular}: fields, records, links with their state, notes`)
    .argument("<slug>", "File name under the root, without .md")
    .option("--json", "Machine-readable output")
    .action(async (slug: string, opts: { json?: boolean }) => {
      await prepare();
      try {
        const e = await getEntity(def, slug);
        if (!e) die(`no ${def.singular} "${slug}"`);
        if (opts.json) console.log(JSON.stringify(e, null, 2));
        else printDetail(def, e!);
      } catch (err) {
        die((err as Error).message);
      }
    });

  withFields(
    group
      .command("create")
      .description(`Create a ${def.singular} file from its title and fields`)
      .argument("<title>", "Display title; the file name derives from it unless --slug is given")
      .option("--slug <slug>", "File name under the root (lowercase, digits, dashes)")
      .option("--notes <text>", "The Markdown body")
      .option("--notes-file <path>", "Read the body from a file")
      .option("--json", `Print the new ${def.singular} as JSON`),
  ).action(async (title: string, opts: Record<string, unknown> & { slug?: string; notes?: string; notesFile?: string; json?: boolean }) => {
    await prepare();
    try {
      const notes = opts.notesFile ? await readFile(opts.notesFile, "utf8") : opts.notes;
      const e: EntityDetail<EntityBase> = await createEntity(def, { ...fieldsOf(def, opts), title, slug: opts.slug, ...(notes !== undefined ? { notes } : {}) });
      if (opts.json) console.log(JSON.stringify(e, null, 2));
      else {
        const missing = Object.values(e.links).flat().filter((l) => !l.found);
        console.log(`${chalk.green("✔")} ${chalk.cyan(`${def.singular}:${e.slug}`)} → ${e.path}${missing.length ? chalk.yellow(` (not found in this workspace yet: ${missing.map((l) => l.slug).join(", ")})`) : ""}`);
      }
    } catch (err) {
      die((err as Error).message);
    }
  });

  withFields(
    group
      .command("set")
      .description(`Change a ${def.singular}'s fields ("" clears one) or notes`)
      .argument("<slug>", "File name under the root")
      .option("--title <text>", "New title")
      .option("--notes <text>", "Replace the Markdown body")
      .option("--notes-file <path>", "Replace the body with a file's content")
      .option("--json", `Print the ${def.singular} as JSON`),
  ).action(async (slug: string, opts: Record<string, unknown> & { notes?: string; notesFile?: string; json?: boolean }) => {
    await prepare();
    try {
      const notes = opts.notesFile ? await readFile(opts.notesFile, "utf8") : opts.notes;
      const input = { ...fieldsOf(def, opts), ...(notes !== undefined ? { notes } : {}) };
      if (Object.keys(input).length === 0) die(`nothing to set — pass --${def.fields.map((f) => f.name).join(", --")}, --tags, --title or --notes`);
      const e = await saveEntity(def, slug, input);
      if (opts.json) console.log(JSON.stringify(e, null, 2));
      else console.log(`${chalk.green("✔")} ${chalk.cyan(`${def.singular}:${e.slug}`)} — ${def.describe(e)}`);
    } catch (err) {
      die((err as Error).message);
    }
  });

  group
    .command("remove")
    .description(`Move a ${def.singular} file to the trash (\`kraftwerk trash\` puts it back)`)
    .argument("<slug>", "File name under the root")
    .action(async (slug: string) => {
      await prepare();
      try {
        await deleteEntity(def, slug);
        console.log(`${chalk.green("✔")} moved ${chalk.cyan(`${def.singular}:${slug}`)} to the trash`);
      } catch (err) {
        die((err as Error).message);
      }
    });
}

export const registerContactCommands = (program: Command): void => registerEntityCommands(program, CONTACTS);
export const registerPlaceCommands = (program: Command): void => registerEntityCommands(program, PLACES);
export const registerEventCommands = (program: Command): void => registerEntityCommands(program, EVENTS);

const refLine = (r: ResolvedRef): string => `${mark(r.found)} ${r.token}${r.label ? chalk.dim(`  ${r.label}`) : r.found ? "" : chalk.dim("  (not found)")}`;

/** `kraftwerk ref` — resolve one reference, or every reference in a file. */
export function registerRefCommand(program: Command): void {
  program
    .command("ref")
    .description("Resolve a reference (contact:anna-meier, place:…, event:…, project:…, agent:…, workflow:…, repo:…, vibeable:…, knowledge:…) or every one in a file")
    .argument("[ref]", "The reference, <kind>:<slug>")
    .option("--file <path>", "Resolve every reference found in this file")
    .option("--json", "Machine-readable output")
    .action(async (ref: string | undefined, opts: { file?: string; json?: boolean }) => {
      await prepare();
      let refs: ResolvedRef[];
      if (opts.file) refs = await resolveTokens(findRefs(await readFile(opts.file, "utf8").catch((e: Error) => die(e.message))));
      else if (ref) {
        const r = await resolveRef(ref);
        if (!r) die(`not a reference: "${ref}" (expected <kind>:<slug>, e.g. contact:anna-meier)`);
        refs = [r!];
      } else die("pass a reference like contact:anna-meier, or --file <path>");
      if (opts.json) console.log(JSON.stringify({ refs: refs! }, null, 2));
      else if (refs!.length === 0) console.log(chalk.dim("no references found"));
      else for (const r of refs!) console.log(refLine(r));
      if (refs!.some((r) => !r.found)) process.exit(1);
    });
}
