import * as z from "zod";
import type { EntityKind } from "../../config.js";
import { CONTACTS, createEntity, deleteEntity, EVENTS, getEntity, listEntities, openEntities, PLACES, saveEntity, type EntityBase, type EntityInput, type EntityKindDef } from "../../core/entities.js";
import { findRefs, parseRef, resolveTokens, type RefKind } from "../../core/refs.js";
import { fail, reply, route, statusByMessage } from "./router.js";

/**
 * Contacts, places and events over the API. One factory, three kinds: the
 * routes are named per kind (`contacts.list`, `places.get`, `events.save`)
 * with the kind's own result type, so the typed client and the UI see
 * three ordinary route families — not one generic entities endpoint whose
 * results would be a union. Adding a kind is one definition in
 * core/entities.ts and one factory call below.
 */
export function entityRoutes<D extends EntityBase, K extends EntityKind>(def: EntityKindDef<D, K>) {
  const errors = statusByMessage(new RegExp(`^no ${def.singular}`));
  const kind = def.kind;
  /** The editable fields. Loose: the domain checks values and keeps what it knows (unknown keys stay in the frontmatter). */
  const Fields = z.looseObject({
    title: z.string().optional(),
    notes: z.string().optional(),
    tags: z.unknown().optional(),
    records: z.unknown().optional(),
    ...Object.fromEntries(def.fields.map((f) => [f.name, z.unknown().optional()])),
  });
  const Create = Fields.extend({ title: z.string(), slug: z.string().optional() });
  const fieldNames = def.fields.map((f) => f.name).join(", ");
  return [
    route(
      { name: `${kind}.list` as `${K}.list`, method: "GET", path: `/api/${kind}` as `/api/${K}`, summary: `every ${def.singular} file under the root${def.span ? " (?from=&to= narrow by date; an entry counts while it runs)" : ""}` },
      async (c) => listEntities(def, { from: c.query.get("from") ?? undefined, to: c.query.get("to") ?? undefined }),
    ),
    route(
      { name: `${kind}.create` as `${K}.create`, method: "POST", path: `/api/${kind}` as `/api/${K}`, summary: `create one {title, slug?, notes?, tags?, records?, ${fieldNames}}`, errors: 400, body: Create },
      async (c) => {
        if ((await openEntities(kind)).off) fail(409, `${kind} are off`);
        return reply(201, await createEntity(def, (await c.body()) as EntityInput));
      },
    ),
    route({ name: `${kind}.get` as `${K}.get`, method: "GET", path: `/api/${kind}/:slug` as `/api/${K}/:slug`, summary: "fields, notes and link states", errors }, async (c) =>
      (await getEntity(def, c.params.slug)) ?? fail(404, `no ${def.singular} "${c.params.slug}"`),
    ),
    route({ name: `${kind}.save` as `${K}.save`, method: "PUT", path: `/api/${kind}/:slug` as `/api/${K}/:slug`, summary: 'save fields and notes ("" clears a field)', errors, body: Fields }, async (c) =>
      saveEntity(def, c.params.slug, (await c.body()) as EntityInput),
    ),
    route({ name: `${kind}.delete` as `${K}.delete`, method: "DELETE", path: `/api/${kind}/:slug` as `/api/${K}/:slug`, summary: "move the file to the trash", errors }, async (c) => {
      await deleteEntity(def, c.params.slug);
      return { ok: true };
    }),
  ] as const;
}

export const contactRoutes = entityRoutes(CONTACTS);
export const placeRoutes = entityRoutes(PLACES);
export const eventRoutes = entityRoutes(EVENTS);

/** References: resolve `kind:slug` tokens — given as a list, or found in a text — against the registry. */
export const refRoutes = [
  route(
    {
      name: "refs.resolve",
      method: "POST",
      path: "/api/refs/resolve",
      summary: "resolve references {tokens?: [kind:slug], text?} to whether each target exists and where it opens",
      errors: 400,
      body: z.object({ tokens: z.array(z.string()).default([]), text: z.string().default("") }),
    },
    async (c) => {
      const { tokens, text } = await c.body();
      const given = tokens.map((t) => parseRef(t) ?? fail(400, `not a reference: "${t}" (expected <kind>:<slug>, e.g. contact:anna-meier)`));
      const found = findRefs(text);
      const all = [...given, ...found].filter((r, i, arr) => arr.findIndex((x) => x.kind === r.kind && x.slug === r.slug) === i) as Array<{ kind: RefKind; slug: string }>;
      return { refs: await resolveTokens(all) };
    },
  ),
];
