import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
// In your own project this import is: import { ... } from "nn-agent-framework";
import {
  containsText,
  envelopeContract,
  fileNonEmpty,
  Run,
  runStamp,
  type WorkflowDefinition,
} from "../../src/index.js";
import { poet } from "./agents.js";

/**
 * Minimal demo of every primitive: a code phase prepares the run directory,
 * an agent phase is judged by gates, a second agent phase continues the SAME
 * session (the poet remembers its haikus without re-reading them), and the
 * run ends with the stats summary. No approval loop — see the content
 * workflow in nn-content-workflow-2 for the engineer gate + revision cycle.
 */
export const demoWorkflow: WorkflowDefinition = {
  name: "demo",
  description: "Drei Haikus schreiben, dann in derselben Session kuratieren",

  async run({ request, verbose }) {
    const runDir = path.resolve("output", `run-${runStamp()}`);
    await mkdir(runDir, { recursive: true }); // must exist before Run traces into it

    const run = new Run({
      runDir,
      verbose,
      workspaceContext: `
Arbeitsverzeichnis (alle Dateien hier anlegen): ${runDir}
Dateien: haiku.md (die Haikus). Ein Orchestrator prueft nach jeder Phase
Envelope und Dateien; bei Fehlern bekommst du eine Korrekturanweisung.
`,
    });

    // Deterministic work is a code phase: timed and traced, but no model.
    await run.codePhase("setup", async () => {
      await writeFile(path.join(runDir, "auftrag.txt"), `Thema: ${request}\n`);
    });

    await run.agentPhase({
      name: "write",
      agent: poet,
      prompt: `Schreibe drei Haikus zum Thema "${request}" in die Datei haiku.md.\n\n${envelopeContract("write")}`,
      gates: [fileNonEmpty("haiku.md")],
    });

    await run.agentPhase({
      name: "curate",
      agent: poet,
      prompt: `Waehle dein staerkstes Haiku (du kennst sie aus dieser Session), stelle es an den Anfang von haiku.md und setze darueber eine Titelzeile, die mit "# " beginnt.\n\n${envelopeContract("curate")}`,
      gates: [fileNonEmpty("haiku.md"), containsText("haiku.md", "# ", "Titelzeile")],
    });

    await run.printSummary();
    console.log(`\nArtifacts: ${runDir}`);
  },
};
