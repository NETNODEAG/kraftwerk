import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { CONFIG_SCHEMA_URL, gitignoreHas, SCHEMA_URL } from "../config.js";
import { initBundle, writeConcept } from "../okf.js";

/**
 * `kraftwerk init` — make any repository a kraftwerk consumer in one
 * command: kraftwerk.yml (root marker + config), a kraftwerk-data/ tree with
 * a runnable example workflow, a starter agent ("max"), a demo
 * knowledge bundle, and an output ignore entry. Everything is idempotent:
 * existing files are left untouched and reported.
 */

const DATA_DIR = "kraftwerk-data";

const configTemplate = (name: string) => `# yaml-language-server: $schema=${CONFIG_SCHEMA_URL}
# kraftwerk project config — also marks the project root for the CLI.
# All fields optional. Docs: https://github.com/NETNODEAG/kraftwerk
name: ${JSON.stringify(name)}   # display name, shown in the inspector header + browser tab
icon: "⚡"   # emoji shown as the inspector favicon
port: 1981   # port \`kraftwerk ui\` listens on
workflows: ${DATA_DIR}/workflows   # where workflows live
output: ${DATA_DIR}/output         # where run artifacts land (git-ignored)
knowledge: ${DATA_DIR}/knowledge   # OKF knowledge bundles
agents: ${DATA_DIR}/agents         # agent definitions
skills: ${DATA_DIR}/skills         # workspace skills (shared instruction packages)
# repos:                          # git repositories the agents work on (uncomment both lines to enable)
#   root: ${DATA_DIR}/repos       # clones land here (git-ignored); a bare \`repos:\` uses repos/ instead
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

const AGENT_YML_TEMPLATE = `name: Max - Workflow Runner
emoji: 🛠️
description: Runs and explains this project's workflows
harness: claude
model: sonnet
effort: medium
workflows:
  - hello
knowledge:
  - demo-customer-support
`;

const AGENT_SYSTEM_TEMPLATE = `You are Max, this project's workflow runner. You run and explain the
project's kraftwerk workflows, and you consult the knowledge bundles you
have access to before answering questions they cover.
`;

const SKILL_TEMPLATE = `---
name: daily-summary
description: Summarize what happened in this workspace today (runs, knowledge updates)
---

# Daily summary

When invoked, produce a short summary of today's activity in this workspace:

1. List today's workflow runs and their status.
2. Mention knowledge concepts updated today, if any.
3. Keep it under 10 lines, plain markdown.
`;

const DEMO_BUNDLE = "demo-customer-support";

const DEMO_CONCEPT = `---
type: Playbook
title: Refund handling
description: How support handles refund requests.
tags: [ support, refunds ]
---

# Steps

1. Check the order in the shop backend.
2. Refunds under CHF 50 are approved directly.
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

  await put("kraftwerk.yml", configTemplate(path.basename(path.resolve(cwd))));
  await put(`${DATA_DIR}/workflows/hello/workflow.yml`, WORKFLOW_TEMPLATE);
  await put(`${DATA_DIR}/workflows/hello/prompts/assistant.md`, PERSONA_TEMPLATE);
  await put(`${DATA_DIR}/workflows/hello/prompts/answer.md`, PROMPT_TEMPLATE);

  // Agent "max".
  await put(`${DATA_DIR}/agents/max/agent.yml`, AGENT_YML_TEMPLATE);
  await put(`${DATA_DIR}/agents/max/system.md`, AGENT_SYSTEM_TEMPLATE);

  // Example workspace skill.
  await put(`${DATA_DIR}/skills/daily-summary/SKILL.md`, SKILL_TEMPLATE);

  // Demo knowledge bundle, through the canonical OKF write path so
  // index.md and log.md come out consistent.
  const knowledgeRoot = path.join(cwd, DATA_DIR, "knowledge");
  const bundleRel = `${DATA_DIR}/knowledge/${DEMO_BUNDLE}/`;
  if (await exists(path.join(knowledgeRoot, DEMO_BUNDLE))) {
    skipped.push(bundleRel);
  } else {
    await initBundle(knowledgeRoot, DEMO_BUNDLE);
    await writeConcept(knowledgeRoot, DEMO_BUNDLE, "playbooks/refunds", DEMO_CONCEPT, "kraftwerk-init");
    created.push(bundleRel);
  }

  // .gitignore: the output dir and the repos root (clones must never become
  // gitlinks of the workspace repo). A missing file gets both in one write;
  // an existing one only the entries it lacks.
  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignore = (await readFile(gitignorePath, "utf8").catch(() => null)) ?? null;
  const entries = [`${DATA_DIR}/output`, `${DATA_DIR}/repos`];
  if (gitignore === null) {
    await writeFile(gitignorePath, entries.map((e) => `${e}/\n`).join(""));
    created.push(".gitignore");
  } else {
    const missing = entries.filter((e) => !gitignoreHas(gitignore, e));
    if (missing.length === 0) {
      skipped.push(".gitignore");
    } else {
      await appendFile(gitignorePath, `${gitignore.endsWith("\n") ? "" : "\n"}${missing.map((e) => `${e}/\n`).join("")}`);
      created.push(`.gitignore (${missing.map((e) => `${e}/`).join(", ")} added)`);
    }
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
