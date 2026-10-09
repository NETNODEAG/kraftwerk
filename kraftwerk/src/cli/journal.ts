import chalk from "chalk";
import type { Command } from "commander";
import { appendJournal, JOURNAL_KINDS, readJournal } from "../core/journal.js";
import { initContext as prepare } from "./routines.js";

/**
 * `kraftwerk journal` — an agent's own memory across sessions
 * (agents/<slug>/journal.md). Agents write it from their sessions; every
 * new session starts with the recent part of it:
 *
 *   kraftwerk journal <agent>                          print the journal
 *   kraftwerk journal <agent> "<entry>" [--kind ..]    add a line under today (learned|decided|promised|done|note)
 */
export function registerJournalCommands(program: Command): void {
  program
    .command("journal")
    .description("An agent's journal: print it, or add one line (what it learned, decided, promised, did)")
    .argument("<agent>", "Agent slug (folder under agents/)")
    .argument("[entry]", "One line to add under today's date")
    .option("--kind <kind>", `Kind of entry: ${JOURNAL_KINDS.join(" | ")}`, "note")
    .option("--actor <actor>", "Who writes (default: the agent itself; KRAFTWERK_ACTOR)")
    .action(async (agent: string, entry: string | undefined, opts: { kind: string; actor?: string }) => {
      await prepare();
      try {
        if (!entry) {
          const text = await readJournal(agent);
          console.log(text.trim() || chalk.dim(`${agent}'s journal is empty.`));
          return;
        }
        await appendJournal(agent, entry, { kind: opts.kind, actor: opts.actor ?? process.env.KRAFTWERK_ACTOR });
        console.log(`${chalk.green("✔")} added to ${chalk.cyan(agent)}'s journal`);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(2);
      }
    });
}
