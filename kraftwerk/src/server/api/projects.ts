import * as z from "zod";
import { appendProjectLog, createProject, deleteProject, getProject, linkProject, listProjects, openProjects, saveLayout, saveProject, type SaveProjectInput } from "../../core/projects.js";
import { fail, reply, route, statusByMessage } from "./router.js";

export const projectErrors = statusByMessage(/^no project/);

/** The rail's order: projects above the sections, then each section's. Names and slugs are checked by saveLayout. */
const Layout = z.object({
  top: z.array(z.string()).default([]),
  sections: z.array(z.object({ name: z.string(), projects: z.array(z.string()).default([]) })).default([]),
});

/** A project's editable fields. Loose: the domain checks values and keeps what it knows. */
const ProjectFields = z.looseObject({
  title: z.string().optional(),
  status: z.string().optional(),
  goal: z.string().optional(),
  harness: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  brief: z.string().optional(),
  state: z.string().optional(),
  records: z.unknown().optional(),
  knowledge: z.unknown().optional(),
  vibeables: z.unknown().optional(),
  repos: z.unknown().optional(),
  workflows: z.unknown().optional(),
  agents: z.unknown().optional(),
});

/** Projects: folders with a goal, a brief, a log and links, plus the rail's order. */
export const projectRoutes = [
  route({ name: "projects.list", method: "GET", path: "/api/projects", summary: "every project folder, with the rail's layout" }, async () => listProjects()),
  route(
    {
      name: "projects.create",
      method: "POST",
      path: "/api/projects",
      summary: "create one {title, goal?, slug?} from the starter",
      errors: 400,
      body: z.object({ title: z.string(), goal: z.string().optional(), slug: z.string().optional() }),
    },
    async (c) => {
      if ((await openProjects()).off) fail(409, "projects are off");
      return reply(201, await createProject(await c.body()));
    },
  ),
  route({ name: "projects.saveLayout", method: "PUT", path: "/api/projects", summary: "save the rail's order and sections {top, sections}", errors: projectErrors, body: Layout }, async (c) => ({
    ok: true,
    layout: await saveLayout(await c.body()),
  })),
  route({ name: "projects.get", method: "GET", path: "/api/projects/:slug", summary: "definition, brief, state, log and link states", errors: projectErrors }, async (c) =>
    (await getProject(c.params.slug)) ?? fail(404, `no project "${c.params.slug}"`),
  ),
  route({ name: "projects.save", method: "PUT", path: "/api/projects/:slug", summary: "save fields", errors: projectErrors, body: ProjectFields }, async (c) =>
    saveProject(c.params.slug, (await c.body()) as SaveProjectInput),
  ),
  route({ name: "projects.delete", method: "DELETE", path: "/api/projects/:slug", summary: "move the folder to the trash", errors: projectErrors }, async (c) => {
    await deleteProject(c.params.slug);
    return { ok: true };
  }),
  route(
    {
      name: "projects.log",
      method: "POST",
      path: "/api/projects/:slug/log",
      summary: "append a stamped line {entry, actor?} to log.md",
      errors: projectErrors,
      body: z.object({ entry: z.string(), actor: z.string().default("human:user") }),
    },
    async (c) => {
      const { entry, actor } = await c.body();
      return { ok: true, log: await appendProjectLog(c.params.slug, entry, actor) };
    },
  ),
  route(
    {
      name: "projects.link",
      method: "POST",
      path: "/api/projects/:slug/links",
      summary: "add or drop one linked slug {kind, target, remove?}",
      errors: projectErrors,
      body: z.object({ kind: z.string(), target: z.string(), remove: z.boolean().default(false) }),
    },
    async (c) => {
      const { kind, target, remove } = await c.body();
      return linkProject(c.params.slug, kind, target, remove);
    },
  ),
];
