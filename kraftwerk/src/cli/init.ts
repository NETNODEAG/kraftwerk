import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { SCHEMA_URL } from "../config.js";

/**
 * `kraftwerk init` — make any repository a kraftwerk consumer in one
 * command: kraftwerk.yml (root marker + config), workflows/ with a runnable
 * example, and an output/ ignore entry. Everything is idempotent: existing
 * files are left untouched and reported.
 */

const CONFIG_TEMPLATE = `# kraftwerk project config — also marks the project root for the CLI.
# All fields optional. Docs: https://github.com/NETNODEAG/kraftwerk
workflows: workflows   # where workflows live
output: output         # where run artifacts land (git-ignored)
`;

const WORKFLOW_TEMPLATE = `# yaml-language-server: $schema=${SCHEMA_URL}
name: hello
description: "Example workflow: one agent answers the request in a file"
workspace: |
  Files: answer.md (the result).
agents:
  assistant:
    model: haiku
    tools: [Read, Write, Edit]
    persona: prompts/assistant.md
steps:
  - name: answer
    agent: assistant
    prompt: prompts/answer.md
    gates:
      - file_non_empty: answer.md
`;

const PERSONA_TEMPLATE = `You are a precise assistant. You answer requests concisely and
concretely, and store the result as a file.
`;

const PROMPT_TEMPLATE = `Request: \${{ request }}

Answer the request and write the answer to answer.md
(Markdown, with a short heading).
`;

export async function runInit(cwd: string): Promise<void> {
  const exists = async (p: string) => !!(await stat(p).catch(() => null));
  const created: string[] = [];
  const skipped: string[] = [];

  const put = async (rel: string, content: string) => {
    const abs = path.join(cwd, rel);
    if (await exists(abs)) {
      skipped.push(rel);
      return;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
    created.push(rel);
  };

  await put("kraftwerk.yml", CONFIG_TEMPLATE);
  await put("workflows/hello/workflow.yml", WORKFLOW_TEMPLATE);
  await put("workflows/hello/prompts/assistant.md", PERSONA_TEMPLATE);
  await put("workflows/hello/prompts/answer.md", PROMPT_TEMPLATE);

  // .gitignore: append output/ if it's not covered yet.
  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignore = (await readFile(gitignorePath, "utf8").catch(() => null)) ?? null;
  if (gitignore === null) {
    await writeFile(gitignorePath, "output/\n");
    created.push(".gitignore");
  } else if (!gitignore.split("\n").some((l) => l.trim().replace(/\/$/, "") === "output")) {
    await appendFile(gitignorePath, `${gitignore.endsWith("\n") ? "" : "\n"}output/\n`);
    created.push(".gitignore (output/ added)");
  } else {
    skipped.push(".gitignore");
  }

  for (const f of created) console.log(`${chalk.green("✔")} ${f}`);
  for (const f of skipped) console.log(`${chalk.dim("• skipped (exists):")} ${chalk.dim(f)}`);
  console.log(
    `\nNext steps:\n` +
      `  kraftwerk list\n` +
      `  kraftwerk run hello "What is kraftwerk?"\n` +
      chalk.dim(`  (editor validation comes from the $schema line in workflow.yml)`)
  );
}
