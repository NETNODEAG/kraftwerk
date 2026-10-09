import * as z from "zod";
import { agentsRoot, deleteAgent, getAgent, listAgents, saveAgent, setAgentArchived, type SaveAgentInput } from "../../core/agents.js";
import { appendJournal, readJournal } from "../../core/journal.js";
import { UI_ACTOR } from "../../core/knowledge.js";
import { deleteRoutine, routineStatuses, runRoutineNow, saveRoutine, type SaveRoutineInput } from "../../core/routines.js";
import { deleteAgentSkill, listAgentSkills, readSkill, saveAgentSkill } from "../../core/skills.js";
import { fail, route } from "./router.js";

/** A member's editable fields. Loose: saveAgent checks values (name, harness, effort) and keeps what it knows. */
const AgentFields = z.looseObject({
  name: z.string().optional(),
  emoji: z.string().optional(),
  description: z.string().optional(),
  harness: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  group: z.string().optional(),
  workflows: z.array(z.string()).optional(),
  knowledge: z.array(z.string()).optional(),
  vibeables: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  system: z.string().optional(),
});

/** A routine: every field saveRoutine stores (it builds the routine from these alone), so a strict object loses nothing. saveRoutine checks name, prompt and the cron schedule. */
const RoutineFields = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  schedule: z.string().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
});

/** Agents (team members): definition, own skills, journal, routines. */
export const agentRoutes = [
  route({ name: "agents.list", method: "GET", path: "/api/agents", summary: "every member" }, async () => ({ root: await agentsRoot(), agents: await listAgents() })),
  route({ name: "agents.create", method: "POST", path: "/api/agents", summary: "create a member", errors: 400, body: AgentFields }, async (c) =>
    saveAgent({ ...((await c.body()) as SaveAgentInput), slug: undefined }),
  ),
  route({ name: "agents.get", method: "GET", path: "/api/agents/:slug", summary: "one member", errors: 400 }, async (c) => (await getAgent(c.params.slug)) ?? fail(404, "not found")),
  route({ name: "agents.save", method: "PUT", path: "/api/agents/:slug", summary: "save a member", errors: 400, body: AgentFields }, async (c) =>
    saveAgent({ ...((await c.body()) as SaveAgentInput), slug: c.params.slug }),
  ),
  route({ name: "agents.delete", method: "DELETE", path: "/api/agents/:slug", summary: "move a member to the trash", errors: 400 }, async (c) => {
    await deleteAgent(c.params.slug);
    return { ok: true };
  }),
  route(
    {
      name: "agents.archive",
      method: "POST",
      path: "/api/agents/:slug/archive",
      summary: "archive or unarchive {archived}",
      errors: 400,
      body: z.object({ archived: z.boolean().default(false) }),
    },
    async (c) => setAgentArchived(c.params.slug, (await c.body()).archived),
  ),

  route({ name: "agents.skills", method: "GET", path: "/api/agents/:slug/skills", summary: "the agent's own skills", errors: 400 }, async (c) => ({
    skills: await listAgentSkills(c.params.slug),
  })),
  route(
    {
      name: "agents.saveSkill",
      method: "POST",
      path: "/api/agents/:slug/skills",
      summary: "create or update one {name, content}",
      errors: 400,
      body: z.object({ name: z.string().default(""), content: z.string().default("") }),
    },
    async (c) => {
      const { name, content } = await c.body();
      return saveAgentSkill(c.params.slug, name, content);
    },
  ),
  route({ name: "agents.skill", method: "GET", path: "/api/agents/:slug/skills/:name", summary: "one agent skill with its content", errors: 400 }, async (c) => {
    const name = c.params.name.toLowerCase();
    const skill = (await listAgentSkills(c.params.slug)).find((s) => s.name.toLowerCase() === name);
    if (!skill) fail(404, "not found");
    return { ...skill, content: await readSkill(skill) };
  }),
  route({ name: "agents.deleteSkill", method: "DELETE", path: "/api/agents/:slug/skills/:name", summary: "delete one agent skill", errors: 400 }, async (c) => {
    await deleteAgentSkill(c.params.slug, c.params.name);
    return { ok: true };
  }),

  route({ name: "agents.journal", method: "GET", path: "/api/agents/:slug/journal", summary: "the agent's journal", errors: 400 }, async (c) => ({ journal: await readJournal(c.params.slug) })),
  route(
    {
      name: "agents.addJournal",
      method: "POST",
      path: "/api/agents/:slug/journal",
      summary: "a person adds a line {entry, kind?}",
      errors: 400,
      body: z.object({ entry: z.string().default(""), kind: z.string().optional() }),
    },
    async (c) => {
      const { entry, kind } = await c.body();
      return { journal: await appendJournal(c.params.slug, entry, { kind, actor: UI_ACTOR }) };
    },
  ),

  route({ name: "agents.routines", method: "GET", path: "/api/agents/:slug/routines", summary: "the agent's routines with run state", errors: 400 }, async (c) => ({
    routines: await routineStatuses(c.params.slug),
  })),
  route({ name: "agents.saveRoutine", method: "POST", path: "/api/agents/:slug/routines", summary: "create or update a routine", errors: 400, body: RoutineFields }, async (c) =>
    saveRoutine(c.params.slug, (await c.body()) as SaveRoutineInput),
  ),
  route({ name: "agents.deleteRoutine", method: "DELETE", path: "/api/agents/:slug/routines/:id", summary: "delete a routine", errors: 400 }, async (c) => {
    await deleteRoutine(c.params.slug, c.params.id);
    return { ok: true };
  }),
  route({ name: "agents.runRoutine", method: "POST", path: "/api/agents/:slug/routines/:id/run", summary: "run a routine now", errors: 400 }, async (c) =>
    runRoutineNow(c.params.slug, c.params.id),
  ),
];
