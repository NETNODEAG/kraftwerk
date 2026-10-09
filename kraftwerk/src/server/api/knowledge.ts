import * as z from "zod";
import { tildify } from "../../core/instances.js";
import { bundleDetail, conceptDetail, createBundle, deleteBundle, knowledgeIndex, putConcept, verifyFromUi } from "../../core/knowledge.js";
import { getSkill, listSkills, skillsRoot } from "../../core/skills.js";
import { emptyTrash, listTrash, purgeFromTrash, restoreFromTrash, trashRoot } from "../../core/trash.js";
import { ApiError, fail, route } from "./router.js";

/** One concept's markdown; empty id or blank content is refused by the handler. */
const Concept = z.object({ id: z.string().default(""), content: z.string().default("") });
/** A concept or trash entry by id; an empty id is refused by the handler. */
const ById = z.object({ id: z.string().default("") });

/** Knowledge bundles and their concepts, the workspace's skills, and the trash. */
export const knowledgeRoutes = [
  route({ name: "knowledge.list", method: "GET", path: "/api/knowledge", summary: "the bundle index" }, async () => knowledgeIndex()),
  route({ name: "knowledge.create", method: "POST", path: "/api/knowledge", summary: "create a bundle {name}", errors: 400, body: z.object({ name: z.string().default("") }) }, async (c) =>
    createBundle((await c.body()).name.trim()),
  ),
  route({ name: "knowledge.get", method: "GET", path: "/api/knowledge/:bundle", summary: "a bundle's concepts and log" }, async (c) => {
    const detail = await bundleDetail(c.params.bundle).catch(() => {
      throw new ApiError(400, "invalid bundle name");
    });
    return detail ?? fail(404, "not found");
  }),
  route({ name: "knowledge.delete", method: "DELETE", path: "/api/knowledge/:bundle", summary: "move the bundle to the trash", errors: 400 }, async (c) => {
    await deleteBundle(c.params.bundle);
    return { ok: true };
  }),
  route({ name: "knowledge.concept", method: "GET", path: "/api/knowledge/:bundle/concept", summary: "one concept ?id=", errors: 400 }, async (c) =>
    (await conceptDetail(c.params.bundle, c.query.get("id") ?? "")) ?? fail(404, "not found"),
  ),
  route({ name: "knowledge.putConcept", method: "POST", path: "/api/knowledge/:bundle/concept", summary: "write one concept {id, content}", errors: 400, body: Concept }, async (c) => {
    const { id, content } = await c.body();
    if (!id || !content.trim()) fail(400, "id and content are required");
    return putConcept(c.params.bundle, id, content);
  }),
  route({ name: "knowledge.verify", method: "POST", path: "/api/knowledge/:bundle/verify", summary: "a person verifies a concept {id}", errors: 400, body: ById }, async (c) => {
    const { id } = await c.body();
    if (!id) fail(400, "id is required");
    return verifyFromUi(c.params.bundle, id);
  }),

  // Discovered from the workspace root, .claude/skills and ~/.claude/skills.
  route({ name: "skills.list", method: "GET", path: "/api/skills", summary: "every discovered skill" }, async () => {
    const [root, skills] = await Promise.all([skillsRoot(), listSkills()]);
    return { root, skills };
  }),
  route({ name: "skills.get", method: "GET", path: "/api/skills/:name", summary: "one skill with SKILL.md and its bundled files" }, async (c) =>
    (await getSkill(c.params.name)) ?? fail(404, "not found"),
  ),

  route({ name: "trash.list", method: "GET", path: "/api/trash", summary: "what was deleted, newest first", errors: 400 }, async () => ({
    root: tildify(await trashRoot()),
    entries: await listTrash(),
  })),
  route({ name: "trash.empty", method: "DELETE", path: "/api/trash", summary: "empty the trash for good", errors: 400 }, async () => ({ ok: true, purged: await emptyTrash() })),
  route({ name: "trash.restore", method: "POST", path: "/api/trash/restore", summary: "put one {id} back", errors: 400, body: ById }, async (c) => {
    const { id } = await c.body();
    if (!id) fail(400, "id is required");
    return restoreFromTrash(id);
  }),
  route({ name: "trash.purge", method: "POST", path: "/api/trash/purge", summary: "delete one {id} for good", errors: 400, body: ById }, async (c) => {
    const { id } = await c.body();
    if (!id) fail(400, "id is required");
    return purgeFromTrash(id);
  }),
];
