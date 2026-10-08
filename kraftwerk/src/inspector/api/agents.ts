import { agentsRoot, deleteAgent, getAgent, listAgents, saveAgent, setAgentArchived, type SaveAgentInput } from "../agents.js";
import { appendJournal, readJournal } from "../journal.js";
import { UI_ACTOR } from "../knowledge.js";
import { deleteRoutine, routineStatuses, runRoutineNow, saveRoutine, type SaveRoutineInput } from "../routines.js";
import { deleteAgentSkill, listAgentSkills, readSkill, saveAgentSkill } from "../skills.js";
import { fail, route } from "./router.js";

/** Agents (team members): definition, own skills, journal, routines. */
export const agentRoutes = [
  route({ name: "agents.list", method: "GET", path: "/api/agents", summary: "every member" }, async () => ({ root: await agentsRoot(), agents: await listAgents() })),
  route({ name: "agents.create", method: "POST", path: "/api/agents", summary: "create a member", errors: 400 }, async (c) =>
    saveAgent({ ...(await c.body<SaveAgentInput>()), slug: undefined }),
  ),
  route({ name: "agents.get", method: "GET", path: "/api/agents/:slug", summary: "one member", errors: 400 }, async (c) => (await getAgent(c.params.slug)) ?? fail(404, "not found")),
  route({ name: "agents.save", method: "PUT", path: "/api/agents/:slug", summary: "save a member", errors: 400 }, async (c) =>
    saveAgent({ ...(await c.body<SaveAgentInput>()), slug: c.params.slug }),
  ),
  route({ name: "agents.delete", method: "DELETE", path: "/api/agents/:slug", summary: "move a member to the trash", errors: 400 }, async (c) => {
    await deleteAgent(c.params.slug);
    return { ok: true };
  }),
  route({ name: "agents.archive", method: "POST", path: "/api/agents/:slug/archive", summary: "archive or unarchive {archived}", errors: 400 }, async (c) =>
    setAgentArchived(c.params.slug, (await c.body<{ archived?: boolean }>()).archived === true),
  ),

  route({ name: "agents.skills", method: "GET", path: "/api/agents/:slug/skills", summary: "the agent's own skills", errors: 400 }, async (c) => ({
    skills: await listAgentSkills(c.params.slug),
  })),
  route({ name: "agents.saveSkill", method: "POST", path: "/api/agents/:slug/skills", summary: "create or update one {name, content}", errors: 400 }, async (c) => {
    const body = await c.body<{ name?: string; content?: string }>();
    return saveAgentSkill(c.params.slug, String(body.name ?? ""), String(body.content ?? ""));
  }),
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
  route({ name: "agents.addJournal", method: "POST", path: "/api/agents/:slug/journal", summary: "a person adds a line {entry, kind?}", errors: 400 }, async (c) => {
    const body = await c.body<{ entry?: string; kind?: string }>();
    return { journal: await appendJournal(c.params.slug, String(body.entry ?? ""), { kind: body.kind, actor: UI_ACTOR }) };
  }),

  route({ name: "agents.routines", method: "GET", path: "/api/agents/:slug/routines", summary: "the agent's routines with run state", errors: 400 }, async (c) => ({
    routines: await routineStatuses(c.params.slug),
  })),
  route({ name: "agents.saveRoutine", method: "POST", path: "/api/agents/:slug/routines", summary: "create or update a routine", errors: 400 }, async (c) =>
    saveRoutine(c.params.slug, await c.body<SaveRoutineInput>()),
  ),
  route({ name: "agents.deleteRoutine", method: "DELETE", path: "/api/agents/:slug/routines/:id", summary: "delete a routine", errors: 400 }, async (c) => {
    await deleteRoutine(c.params.slug, c.params.id);
    return { ok: true };
  }),
  route({ name: "agents.runRoutine", method: "POST", path: "/api/agents/:slug/routines/:id/run", summary: "run a routine now", errors: 400 }, async (c) =>
    runRoutineNow(c.params.slug, c.params.id),
  ),
];
