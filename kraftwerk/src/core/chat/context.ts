import { getOutputDir, workspaceRoot } from "../context.js";
import { knowledgeIndex } from "../knowledge.js";
import { getRun, listRuns } from "../runs.js";
import { listSkills, readSkill, type SkillInfo } from "../skills.js";
import { listWorkflows } from "../workflows.js";
import { getAgent, listAgents } from "../agents.js";
import { listRepos } from "../repos.js";
import { listVibeables, vibeableStatus, VIBEABLE_CONFIG_FILE } from "../vibeables.js";
import { projectContext } from "../projects.js";
import { unattendedTimeoutLabel } from "./permissions.js";
import type { ChatAgentId, ChatMeta, ChatScope } from "./types.js";
import { getChannel } from "../channels.js";
import { JOURNAL_FILE, journalExcerpt, readJournal } from "../journal.js";
import { filesSummary } from "../files.js";
import { type Seat } from "./state.js";

/**
 * What an agent is told about where it works: the skills it may use and
 * the scope's context block (the workspace, a run, a project, a channel,
 * an app) that goes into the first prompt.
 */

/* ---------- skills ---------- */

/**
 * Skills visible to a chat: every discovered skill (workspace skills root
 * + .claude/skills roots, plus the agent's own agents/<slug>/skills for agent
 * sessions), narrowed by the agent's allowlist when the chat is an agent
 * session (absent allowlist = all, empty = none). The agent's own skills
 * always apply — the allowlist narrows shared skills only.
 */
export async function availableSkills(scope: ChatScope): Promise<SkillInfo[]> {
  const all = await listSkills(scope.kind === "agent" ? scope.slug : undefined).catch(
    () => [] as SkillInfo[]
  );
  if (scope.kind !== "agent") return all;
  const def = await getAgent(scope.slug).catch(() => null);
  if (!def || def.skills === undefined) return all;
  const allowed = new Set(def.skills.map((n) => n.toLowerCase()));
  return all.filter((s) => s.source === "agent" || allowed.has(s.name.toLowerCase()));
}

/** "## Your skills" context block (empty when no skills are visible). */
function skillsBlock(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";
  const lines = skills
    .map((s) => `- /${s.name}${s.description ? `: ${s.description}` : ""} — ${s.path}`)
    .join("\n");
  return (
    `## Your skills\nSkills are reusable instruction packages (a SKILL.md per skill). When the ` +
    `user's request matches one, read its SKILL.md file and follow the instructions in it. The user ` +
    `can also invoke one explicitly by starting a message with /<skill-name>.\n${lines}`
  );
}

/**
 * Explicit skill invocation: a message starting with /<skill-name> is
 * expanded into the skill's SKILL.md instructions (the stored user_message
 * keeps the original "/name args" text). Unknown names pass through as-is.
 */
export async function expandSkillInvocation(scope: ChatScope, text: string): Promise<string> {
  const m = /^\/([A-Za-z0-9][\w-]*)[ \t]*([\s\S]*)$/.exec(text);
  if (!m) return text;
  const skills = await availableSkills(scope);
  const skill = skills.find((s) => s.name.toLowerCase() === m[1].toLowerCase());
  if (!skill) return text;
  const body = await readSkill(skill);
  if (!body.trim()) return text;
  const args = m[2].trim();
  return (
    `The user invoked the skill "${skill.name}" (${skill.path}). Follow the skill's instructions:\n\n` +
    `<skill name="${skill.name}">\n${body.trim()}\n</skill>\n\n` +
    `Arguments the user passed to the skill: ${args || "(none)"}`
  );
}

/* ---------- scope context ---------- */

/** "## Your knowledge" block for a agent's connected OKF bundles. */
async function agentKnowledgeContext(def: {
  slug: string;
  harness: ChatAgentId;
  knowledge: string[];
}): Promise<string> {
  if (def.knowledge.length === 0) return "";
  const { bundles } = await knowledgeIndex().catch(() => ({ bundles: [] }));
  const lines = def.knowledge
    .map((name) => {
      const b = bundles.find((x) => x.name === name);
      return b
        ? `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`
        : `- ${name} (not found in knowledge/ — tell the user if you need it)`;
    })
    .join("\n");
  return (
    `## Your knowledge\nThese OKF knowledge bundles (markdown + YAML frontmatter under knowledge/) are ` +
    `part of your job. Consult them before answering questions in their domain, and keep them current ` +
    `when you learn something durable:\n${lines}\n\n` +
    `Read with \`npx kraftwerk knowledge list <bundle>\`, \`get <bundle>/<path>\`, \`search <text>\`. ` +
    `Write ONLY through \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor ${def.slug}/${def.harness}\` ` +
    `(write the markdown to a temp file first; the CLI stamps provenance and maintains index.md/log.md). ` +
    `Never hand-edit index.md or log.md, and never add \`verified\` yourself — verification is the human's ` +
    `click in the UI.\n\n`
  );
}

/**
 * "## Your journal" block: the recent part of agents/<slug>/journal.md and
 * how to add to it. This is what makes the agent the same colleague from
 * one session to the next.
 */
export async function agentJournalContext(def: { slug: string; harness: ChatAgentId }): Promise<string> {
  const { text, truncated } = journalExcerpt(await readJournal(def.slug).catch(() => ""));
  return (
    `## Your journal
Your own notes from earlier sessions, newest first (agents/${def.slug}/${JOURNAL_FILE}). ` +
    `They are your memory between sessions: build on them, keep what you promised, and check facts that may have changed since.

` +
    (text ? `${text}
` : `(empty: nothing recorded yet)
`) +
    (truncated ? `(older days are in the file; read it when you need them)
` : "") +
    `
Add to it when something should outlive this session, one line each:
` +
    `  npx kraftwerk journal ${def.slug} "<one line>" --kind learned|decided|promised|done
` +
    `learned: a durable fact about the user, the work or the workspace. decided: a decision and its reason. ` +
    `promised: something you said you would do. done: a promise kept or a piece of work finished. ` +
    `Write a few lines at the end of a session that changed something, not a transcript; no secrets. ` +
    `Never edit ${JOURNAL_FILE} by hand.

`
  );
}

/**
 * "## Files" block for an agent: the workspace's files and the folders in
 * it linked to the agent. An agent owns no files; in a project it works
 * with the project's (the project block says where).
 */
export async function agentFilesContext(def: { files?: string[] }): Promise<string> {
  const ws = await filesSummary("workspace").catch(() => null);
  if (!ws) return "";
  const linked = (def.files ?? []).map((f) => `- ${ws.root}/${f}/`).join("\n");
  return (
    `## Files\nThe workspace's shared files (any format: brand assets, templates, contracts, …) are in ${ws.root}/ (${ws.count} file${ws.count === 1 ? "" : "s"}). ` +
    (linked ? `The folders that are part of your job:\n${linked}\n` : "") +
    `Work you do for a project belongs in that project's files folder, not here. What you produce in a direct session goes to ${ws.root}/inbox/. ` +
    `Delete nothing there unless asked.\n\n`
  );
}

/**
 * "## Your vibeables" block: the apps an agent builds and maintains, linked
 * in agent.yml like knowledge. Empty when nothing is linked. When the
 * feature is off the agent hears that its apps are unreachable instead of
 * guessing at folders; a linked folder that is gone is reported, not
 * recreated — the same rule linked knowledge follows.
 */
export async function agentVibeablesContext(def: { vibeables: string[] }): Promise<string> {
  if (def.vibeables.length === 0) return "";
  const view = await listVibeables().catch(() => null);
  if (!view?.enabled || !view.root) {
    return (
      `## Your vibeables\nagent.yml links the vibeables ${def.vibeables.join(", ")} to you, but vibeables are switched off in this ` +
      `workspace's settings, so their folders are not reachable right now — tell the user when they ask about one.\n\n`
    );
  }
  const lines = def.vibeables
    .map((slug) => {
      const v = view.vibeables.find((x) => x.slug === slug);
      if (!v) return `- ${slug} (configured but not found under ${view.root} — tell the user; do not recreate it unasked)`;
      const mode = v.dev ? `dev: ${v.dev}` : "static";
      return `- ${slug} — ${v.path} (${mode}${v.hasIndex ? "" : ", no index.html yet"}${v.configError ? `, ${v.configError}` : ""})`;
    })
    .join("\n");
  return (
    `## Your vibeables\nThese small apps (one folder each under ${view.root}) are yours to build and maintain — ` +
    `you know their code and their purpose:\n${lines}\n\n` +
    `The user opens one in the preview pane with the vibeable button; from then on that folder is your working directory and ` +
    `every file you save is what they see next. Until then you may read them by path and answer questions about them, ` +
    `but make changes only when the user asks for them. \`npx kraftwerk vibeables\` lists every app in the workspace.\n\n`
  );
}

/**
 * "## Repositories" block: the clones under the repos root, when the
 * feature is on. Empty when it is off, so agents in a workspace without
 * it never hear about it.
 */
async function reposContext(): Promise<string> {
  const view = await listRepos().catch(() => null);
  if (!view?.enabled || !view.root) return "";
  const lines = view.repos
    .map((r) => {
      const state = r.error ? `unreadable: ${r.error}` : [r.dirty ? `${r.dirty} uncommitted` : "clean", r.ahead ? `${r.ahead} ahead` : "", r.behind ? `${r.behind} behind` : ""].filter(Boolean).join(", ");
      return `- ${r.slug} — ${r.path}${r.url ? ` (${r.url})` : ""}${r.branch ? `, branch ${r.branch}` : ""}${r.head ? ` @ ${r.head}` : ""}, ${state}`;
    })
    .join("\n");
  return (
    `## Repositories\nGit repositories this workspace works on live under ${view.root} (one clone per folder). ` +
    `When the user names one of them, work inside its folder: read its README and structure first, keep commits on a ` +
    `branch unless told otherwise, and never push or force-push without asking.\n${lines || "(none cloned yet)"}\n\n` +
    `Clone a new one with \`npx kraftwerk repos add <url> [--name <folder>] [--branch <b>] [--depth <n>]\` so it lands in ` +
    `that root (\`--depth 1\` for a large repository; a plain \`git clone\` into that folder works too); ` +
    `\`npx kraftwerk repos\` lists them, \`update <name>\` fetches and fast-forwards a clean clone, \`remove <name>\` ` +
    `deletes one. A repository the user mentions that is not listed is not cloned yet — offer to add it.`
  );
}

/**
 * "## Vibeable" block: the chat has an app folder open in the preview pane.
 * The agent works inside that folder, and everything it saves is what the
 * user sees next — so the block spells out how the preview runs and what
 * the sandbox rules out.
 */
export async function vibeableContext(slug: string, cwd: string): Promise<string> {
  let st: Awaited<ReturnType<typeof vibeableStatus>> | null = null;
  let failure = "";
  try {
    st = await vibeableStatus(slug);
  } catch (err) {
    failure = (err as Error).message;
  }
  if (!st) {
    if (/are off/.test(failure)) {
      return (
        `## Vibeable: ${slug}\nThis chat had the vibeable "${slug}" open, but vibeables have since been switched off in this ` +
        `workspace's settings. Its folder still exists at ${cwd} and is your working directory; there is no preview pane any ` +
        `more. Work in the folder if the user asks, and mention that the feature is off.`
      );
    }
    return `## Vibeable\nThis chat had the vibeable "${slug}" open in its preview pane, but its folder is gone. Tell the user; do not recreate it unasked.`;
  }
  const dev = st.dev;
  const mode = dev?.running
    ? `A dev server is running (\`${dev.command}\`, port ${dev.port}${dev.ready ? "" : ", not answering yet"}); the pane shows it.`
    : st.config.dev
      ? `${VIBEABLE_CONFIG_FILE} declares \`dev: ${st.config.dev}\`; the dev server is not running, so the pane shows the static folder until the user starts it with the play button.`
      : `No dev command: the pane shows the folder${st.config.dir ? ` ${st.config.dir}/` : ""} served as-is.`;
  return (
    `## Vibeable: ${slug}\n` +
    `You are building a small piece of software live with the user. Your working directory is its folder: ${st.path}. ` +
    `The user sees it rendered in a preview pane next to this chat, and every file you save reloads that preview within a second — ` +
    `work in small visible steps, and describe what changed instead of pasting code. Think ad-hoc software, not a website: a dashboard, ` +
    `a slideshow, a calculator, a tracker with a backend — whatever the user asks for.\n\n` +
    `Current state: ${mode}${st.configError ? ` (${st.configError} — fix it)` : ""}\n\n` +
    `How the preview runs:\n` +
    `- Static mode (default): the inspector serves the folder directly at /vibeables/${slug}/ — index.html is the entry; plain HTML, CSS and ` +
    `JavaScript with no build step. Use relative URLs (./app.js, not /app.js). ES modules and CDN imports (https://esm.sh/<pkg>) work. ` +
    `The preview is a sandboxed document in both modes: no localStorage, no cookies, no calls into the inspector's own /api. Keep state in ` +
    `memory, or move to dev mode and persist through your own server.\n` +
    `- Dev mode: when the app needs a build tool, a backend or a database, write ${VIBEABLE_CONFIG_FILE} with \`dev: <command>\` ` +
    `(e.g. \`npm run dev\`, \`node server.js\`, \`python3 -m http.server $PORT\`). kraftwerk starts it inside the folder with PORT in the ` +
    `environment and the pane reaches it through /vibeables/${slug}/ on the inspector (BASE_PATH holds that prefix — a dev server that ` +
    `emits absolute URLs, like Vite, must use it as its base); the command must listen on $PORT (or declare \`port:\` when it cannot). Optional ` +
    `\`dir:\` picks the folder for static mode (e.g. dist). The app brings its own backend and storage — a small node server writing JSON ` +
    `files, SQLite, an external API — nothing of that is provided by kraftwerk.\n\n` +
    `Rules: the folder is part of this workspace and versioned with it — do not run git yourself, the user reviews and commits from the ` +
    `inspector's Git screen; keep secrets out of the folder (.env is git-ignored, node_modules too); leave ${VIBEABLE_CONFIG_FILE} valid YAML; ` +
    `when you switch the app to dev mode, say so and ask the user to press play in the pane. Reply briefly — the preview shows the result.`
  );
}

/** Base context per scope; scopeContext() appends the shared skills block. */
async function baseScopeContext(scope: ChatScope, agent: ChatAgentId): Promise<string> {
  if (scope.kind === "agent") {
    const def = await getAgent(scope.slug).catch(() => null);
    if (!def) {
      return `You were opened as agent "${scope.slug}", but its definition under agents/ is missing. Tell the user and ask them to recreate it.`;
    }
    const { workflows } = await listWorkflows().catch(() => ({ workflows: [] }));
    const connected = workflows.filter((w) => def.workflows.includes(w.slug));
    const missing = def.workflows.filter((slug) => !connected.some((w) => w.slug === slug));
    const wfLines = connected
      .map((w) => `- ${w.slug}: ${w.description ?? w.name ?? ""} (${w.steps} steps)`)
      .join("\n");
    return (
      `You are ${def.emoji} ${def.name}, a persistent agent of this project ` +
      `(defined in agents/${def.slug}/). The user works with you like with a colleague: every session ` +
      `is a conversation with the same ${def.name}, so keep this role consistently. You are an AI agent, ` +
      `not a human — never pretend otherwise, but do own your role.\n\n` +
      `## Your role\n${def.system || "(no system prompt written yet — ask the user what your job should be)"}\n\n` +
      (def.workflows.length > 0
        ? `## Your workflows\nThese kraftwerk workflows are part of your job. When the user's request matches one, ` +
          `run it yourself instead of doing the work by hand:\n${wfLines || "(none found)"}\n` +
          (missing.length > 0
            ? `(configured but not found in this project: ${missing.join(", ")})\n`
            : "") +
          `\nRun a workflow with:\n` +
          `  KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"\n` +
          `The command blocks until the run finishes; artifacts land in output/runs/*/ — tell the user the ` +
          `run id and summarize the result. Confirm with the user before starting a long or expensive run ` +
          `unless they clearly asked for it.\n\n`
        : "") +
      (await agentKnowledgeContext(def)) +
      (await agentVibeablesContext(def)) +
      (await agentJournalContext(def)) +
      (await agentFilesContext(def)) +
      `The working directory is the project root. Stay within your role; if a request is clearly outside it, ` +
      `say so and suggest which agent or tool fits better.` +
      (scope.routine
        ? `\n\nThis session was started automatically by your scheduled routine "${scope.routine}" — ` +
          `nobody may be watching live. Complete the task autonomously. Edits inside the project ` +
          `need no approval; anything your harness asks about (shell commands, network, files ` +
          `outside the project) is shown to a human who may look later — say in one line why you ` +
          `need it, then continue with what you can. A request nobody answers within ` +
          `${unattendedTimeoutLabel()} is declined: report what you could not do and why, do ` +
          `not retry it another way. End with a clear, self-contained summary of what you did and found.`
        : "")
    );
  }
  if (scope.kind === "project") {
    // Everything the project gathered — brief, state, records, links — plus
    // how to keep it current; see projects.ts for the block.
    return projectContext(scope.slug, `kraftwerk-chat/${agent}`);
  }
  if (scope.kind === "knowledge") {
    const { root, bundles } = await knowledgeIndex().catch(() => ({ root: "", bundles: [] }));
    const bundleLines = bundles
      .map((b) => `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`)
      .join("\n");
    return (
      `You are the knowledge curator inside the kraftwerk inspector ("Knowledge"). ` +
      `This project keeps knowledge as OKF v0.2 bundles (Open Knowledge Format): directories of markdown ` +
      `files with YAML frontmatter under ${root || "knowledge/"}. Each direct subdirectory is one bundle; each .md file ` +
      `(except the reserved index.md and log.md) is one concept.\n\n` +
      `Existing bundles:\n${bundleLines || "(none yet)"}\n` +
      (scope.bundle ? `\nThe user wants to work on the "${scope.bundle}" bundle.\n` : "") +
      `\nOKF essentials:\n` +
      `- Frontmatter needs exactly one required key: \`type\` (free-form, e.g. Playbook, Metric, Reference, API Endpoint). ` +
      `Recommended: title, description, tags, resource (canonical URI of the described asset).\n` +
      `- Provenance/trust families (all optional): \`sources\` (list of { id, resource, title, author, usage_count, last_modified }), ` +
      `\`generated: { by, at }\`, \`verified: [{ by, at }]\`, \`status\` (draft|stable|deprecated), \`stale_after\` (ISO datetime).\n` +
      `- Actors: \`<producer>/<version>\` for agents, \`human:<id>\` for people, \`process:<id>\` for automation.\n` +
      `- Concepts cross-link with normal markdown links, bundle-absolute (\`/path/concept.md\`) preferred. ` +
      `Per-claim attribution uses markdown footnotes whose label is a \`sources[].id\`.\n` +
      `- Favor structural markdown (headings, tables, lists) over prose.\n\n` +
      `ALWAYS write through the kraftwerk CLI so provenance is stamped and the bundle log/index stay maintained:\n` +
      `- \`npx kraftwerk knowledge init <bundle>\` — new bundle\n` +
      `- \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor kraftwerk-chat/${agent}\` — create/update a concept ` +
      `(write the markdown to a temp file first; the CLI stamps generated.by/at, appends log.md, regenerates index.md)\n` +
      `- \`npx kraftwerk knowledge list [bundle]\`, \`get <bundle>/<path>\`, \`search <text>\`, \`validate\`\n` +
      `Do not hand-edit index.md or log.md (derived/maintained), and do not add \`verified\` yourself — ` +
      `verification is the human's click in the UI. Ask the user what knowledge to capture, then author concise, well-typed concepts.`
    );
  }
  if (scope.kind === "kraftwerk") {
    const [{ workflows }, runs, knowledge, agents] = await Promise.all([
      listWorkflows(),
      listRuns(),
      knowledgeIndex().catch(() => ({ bundles: [] })),
      listAgents().catch(() => []),
    ]);
    const wfLines = workflows
      .map((w) => `- ${w.slug}: ${w.description ?? w.name ?? ""} (${w.steps} steps, ${w.agents} agents)`)
      .join("\n");
    const runLines = runs
      .slice(0, 10)
      .map((r) => `- ${r.id} — ${r.workflow ?? "?"} [${r.status}] ${r.request ?? ""}`.trim())
      .join("\n");
    const bundleLines = knowledge.bundles
      .map((b) => `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`)
      .join("\n");
    const agentLines = agents
      .map((m) => `- ${m.emoji} ${m.name} (${m.slug})${m.description ? `: ${m.description}` : ""}`)
      .join("\n");
    return (
      `You are Ralv, the chief of staff of this kraftwerk workspace — its concierge. You know everything about the ` +
      `workspace (below), give advice on what to do next, and help launch things: projects, agents, workflows, ` +
      `knowledge. Introduce yourself as Ralv when asked who you are. The inspector is a UI for a workflow-as-code agent framework. ` +
      `The consumer project root is ${workspaceRoot()}; run outputs live in ${getOutputDir()} (one folder per run under runs/, each with a trace.jsonl and working files). ` +
      `Everything below is current — no need to re-discover the project layout or the CLI before acting.\n\n` +
      `## Workflows\n${wfLines || "(none)"}\n\n` +
      `Run one directly with:\n` +
      `  KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"\n` +
      `The command blocks until the run finishes and prints the run id; artifacts land in the output ` +
      `folder above. When the user's request matches a workflow, run it instead of doing the work by hand.\n\n` +
      `## Recent runs\n${runLines || "(none)"}\n\n` +
      `## Knowledge\nOKF bundles in this project:\n${bundleLines || "(none)"}\n` +
      `Read with \`npx kraftwerk knowledge list [bundle]\`, \`get <bundle>/<path>\`, \`search <text>\`. ` +
      `Write ONLY through \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor kraftwerk-chat/${agent}\` ` +
      `(stamps provenance, maintains index.md/log.md — never hand-edit those).\n\n` +
      `## Agents\n${agentLines || "(none)"}\n` +
      `These are persistent agents (defined under agents/); the user talks to them on the ` +
      `Agents screen. Point the user there when a request clearly belongs to one of them.\n\n` +
      (await agentFilesContext({})) +
      `Answer questions about workflows and runs by reading the files above. Do not modify run outputs unless asked.`
    );
  }
  if (scope.kind === "run") {
    const run = await getRun(scope.runId);
    if (!run) return `The user wants to discuss kraftwerk run ${scope.runId}, but it was not found.`;
    const phases = run.phases
      .map((p) => `- ${p.phase} [${p.status}]${p.summary ? `: ${p.summary}` : ""}`)
      .join("\n");
    const files = run.files.map((f) => `- ${f.name} (${f.size} bytes)`).join("\n");
    return (
      `You are the assistant for one kraftwerk workflow run. Your working directory is the run's output folder.\n\n` +
      `Run ${run.id} — workflow "${run.workflow ?? "?"}", status ${run.status}.\n` +
      `Request: ${run.request ?? "(none)"}\n\nPhases:\n${phases || "(none)"}\n\nFiles in this folder:\n${files || "(none)"}\n\n` +
      `trace.jsonl holds the full event log. Read files as needed to answer; do not modify the run's artifacts unless asked.`
    );
  }
  return "";
}

/**
 * Every chat renders in the inspector UI, so agents should know two things:
 * replies are markdown, and run artifacts are addressable over the
 * inspector's own file endpoint (relative URLs keep working wherever the
 * inspector is reachable — localhost, LAN, a reverse proxy).
 */
const RENDERING_BLOCK =
  `## Chat rendering\n` +
  `Your replies render as markdown in the inspector chat: headings, lists, tables, code blocks, ` +
  `links and images all work. Files inside a workflow run's output folder are served by the ` +
  `inspector itself at /api/runs/<run-id>/file?name=<relative-path>&raw=1 — embed an image inline ` +
  `with ![alt](/api/runs/<run-id>/file?name=picture.png&raw=1), or link any artifact the same way. ` +
  `Prefer these relative /api/... URLs over file paths when showing results: they render directly ` +
  `in this chat and keep working wherever the inspector is reachable.`;

export async function scopeContext(meta: ChatMeta, seat: Seat): Promise<string> {
  // A channel seat is the member agent in its own right: persona, skills and
  // repositories as in its direct sessions, plus the channel rules.
  const scope: ChatScope = meta.scope.kind === "channel" ? { kind: "agent", slug: seat.key } : meta.scope;
  const agent = seat.harness;
  // The repositories block reads every clone from git, so it runs alongside
  // the rest instead of adding its spawns to the first prompt's latency.
  const [base, repos, vibe, skills, channel, project] = await Promise.all([
    baseScopeContext(scope, agent),
    scope.kind === "agent" || scope.kind === "kraftwerk" ? reposContext() : Promise.resolve(""),
    meta.vibeable ? vibeableContext(meta.vibeable, meta.cwd) : Promise.resolve(""),
    availableSkills(scope),
    meta.scope.kind === "channel" ? channelContext(meta.scope.slug, seat.key) : Promise.resolve(""),
    // A channel that works in a project: every member reads the project too, as a member, not as its assistant.
    meta.scope.kind === "channel" && meta.project ? projectContext(meta.project, `${seat.key}/${agent}`, { member: true }) : Promise.resolve(""),
  ]);
  return [base, channel, project, repos, vibe, RENDERING_BLOCK, skillsBlock(skills)].filter(Boolean).join("\n\n");
}

/** The channel block a member agent gets once per process: who is here, how turns work, how to hand over. */
async function channelContext(slug: string, self: string): Promise<string> {
  const channel = await getChannel(slug).catch(() => null);
  if (!channel) return `You sit in channel #${slug}, but its definition under channels/ is missing. Tell the humans.`;
  const agents = await listAgents().catch(() => []);
  const others = channel.members
    .filter((m) => m !== self)
    .map((m) => {
      const a = agents.find((x) => x.slug === m);
      return `- @${m}${a ? ` — ${a.emoji} ${a.name}${a.description ? `: ${a.description}` : ""}` : ""}`;
    })
    .join("\n");
  return (
    `## Channel #${channel.slug} — ${channel.name}\n` +
    (channel.purpose ? `Purpose: ${channel.purpose}\n` : "") +
    `This is a group conversation, like a Slack channel: humans and several agents share one transcript. ` +
    `You are @${self}. Other agents here:\n${others || "(none — you are the only agent)"}\n\n` +
    `How it works: each time you are woken you receive the messages posted since your last turn, each prefixed ` +
    `with its author ("[Lukas]:" is a human, "[@slug]:" an agent). Reply as yourself, to the channel — everyone reads it. ` +
    `You are woken when a message @mentions you` +
    (channel.responder === self ? `, and for every message that mentions nobody (you are the channel's responder)` : "") +
    `. To hand a task to another agent, @mention them in your reply and say what you need; they are woken with your ` +
    `message. Do not mention an agent just to be polite — every mention starts a turn, and handovers are limited to ` +
    `${channel.maxHops} per human message. Do not repeat what others already said; add your part. Keep replies short ` +
    `unless the task needs detail; a long result is better as a file in the project than as a wall of text.`
  );
}
