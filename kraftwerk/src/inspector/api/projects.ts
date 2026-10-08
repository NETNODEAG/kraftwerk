import { appendProjectLog, createProject, deleteProject, getProject, linkProject, listProjects, openProjects, saveLayout, saveProject, type SaveProjectInput } from "../projects.js";
import { fail, reply, route, statusByMessage } from "./router.js";

export const projectErrors = statusByMessage(/^no project/);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Projects: folders with a goal, a brief, a log and links, plus the rail's order. */
export const projectRoutes = [
  route({ name: "projects.list", method: "GET", path: "/api/projects", summary: "every project folder, with the rail's layout" }, async () => listProjects()),
  route({ name: "projects.create", method: "POST", path: "/api/projects", summary: "create one {title, goal?, slug?} from the starter", errors: 400 }, async (c) => {
    if ((await openProjects()).off) fail(409, "projects are off");
    const body = await c.body<{ title?: unknown; goal?: unknown; slug?: unknown }>();
    return reply(201, await createProject({ title: str(body.title) ?? "", goal: str(body.goal), slug: str(body.slug) }));
  }),
  route({ name: "projects.saveLayout", method: "PUT", path: "/api/projects", summary: "save the rail's order and sections {top, sections}", errors: projectErrors }, async (c) => ({
    ok: true,
    layout: await saveLayout(await c.body()),
  })),
  route({ name: "projects.get", method: "GET", path: "/api/projects/:slug", summary: "definition, brief, state, log and link states", errors: projectErrors }, async (c) =>
    (await getProject(c.params.slug)) ?? fail(404, `no project "${c.params.slug}"`),
  ),
  route({ name: "projects.save", method: "PUT", path: "/api/projects/:slug", summary: "save fields", errors: projectErrors }, async (c) =>
    saveProject(c.params.slug, await c.body<SaveProjectInput>()),
  ),
  route({ name: "projects.delete", method: "DELETE", path: "/api/projects/:slug", summary: "move the folder to the trash", errors: projectErrors }, async (c) => {
    await deleteProject(c.params.slug);
    return { ok: true };
  }),
  route({ name: "projects.log", method: "POST", path: "/api/projects/:slug/log", summary: "append a stamped line {entry, actor?} to log.md", errors: projectErrors }, async (c) => {
    const body = await c.body<{ entry?: unknown; actor?: unknown }>();
    return { ok: true, log: await appendProjectLog(c.params.slug, str(body.entry) ?? "", str(body.actor) ?? "human:user") };
  }),
  route({ name: "projects.link", method: "POST", path: "/api/projects/:slug/links", summary: "add or drop one linked slug {kind, target, remove?}", errors: projectErrors }, async (c) => {
    const body = await c.body<{ kind?: unknown; target?: unknown; remove?: unknown }>();
    return linkProject(c.params.slug, str(body.kind) ?? "", str(body.target) ?? "", body.remove === true);
  }),
];
