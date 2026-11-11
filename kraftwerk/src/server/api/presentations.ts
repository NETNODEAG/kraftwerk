import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import * as z from "zod";
import {
  createDeck,
  deckSlidePng,
  deleteDeck,
  exportBytes,
  getDeck,
  listAllDecks,
  listDecks,
  listTemplates,
  openPresentations,
  saveAsset,
  addComment,
  updateComment,
  deleteComment,
  StaleDeckError,
  existingDeckDir,
  deckVersions,
  deckVersion,
  deckFile,
  templateFile,
  saveDeck,
  type PresentationRef,
} from "../../core/presentations/index.js";
import { ApiError, fail, reply, route, statusByMessage, type Ctx } from "./router.js";
import { localPerson } from "../../core/chat/sessions.js";
import { tasksReferencing } from "../../core/boards.js";
import { leavePresence, touchPresence } from "../../core/presentations/presence.js";
import type { Trust } from "../trust.js";

/**
 * Presentations over the API. A deck is addressed by its name and, for a
 * project's deck, `?project=<slug>`. `get` carries everything the editor
 * needs (the parsed slides, the source, the template's layouts and slots,
 * the render warnings); `slide` serves one slide as PNG and `export` the
 * PPTX or PDF — all from the same render (core/presentations).
 */
export const presentationErrors = statusByMessage(/^no (presentation|slide|project)/);

const Slide = z.object({
  layout: z.string().optional(),
  notes: z.string().optional(),
  background: z.string().optional(),
  transition: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  content: z.string(),
});

const SaveFields = z.object({
  /** The updatedAt the caller's copy was read at: a deck changed since then is not overwritten (409 with the current updatedAt). */
  base: z.string().optional(),
  source: z.string().optional(),
  title: z.string().optional(),
  template: z.string().optional(),
  size: z.enum(["16:9", "4:3"]).nullable().optional(),
  /** false: no slide numbers in the deck (`numbers: false` in its headmatter); true or null: back on. */
  numbers: z.boolean().nullable().optional(),
  slides: z.array(Slide).optional(),
});

const CreateFields = z.object({
  project: z.string().optional(),
  title: z.string(),
  slug: z.string().optional(),
  template: z.string().optional(),
  source: z.string().optional(),
});

const refOf = (c: Ctx<any>): PresentationRef => {
  const project = c.query.get("project");
  return { ...(project ? { project } : {}), name: c.params.name };
};

/** Who writes a comment: a member by their handle, else this machine's person. */
const authorOf = async (trust: Trust): Promise<string> => (trust.kind === "member" ? trust.member.handle : (await localPerson()).handle);

const requireOn = async (): Promise<void> => {
  if ((await openPresentations()).off) fail(409, "presentations are off");
};

/** A deck's or a template's file, as the browser asks for it. SVGs run no scripts here. */
async function sendFile(c: Ctx<any>, f: { path: string; mime: string }): Promise<void> {
  const st = await stat(f.path);
  c.res.writeHead(200, {
    "content-type": f.mime,
    "content-length": st.size,
    "cache-control": "private, max-age=0, must-revalidate",
    "last-modified": st.mtime.toUTCString(),
    "x-content-type-options": "nosniff",
    ...(f.mime === "image/svg+xml" ? { "content-security-policy": "sandbox" } : {}),
  });
  createReadStream(f.path).pipe(c.res);
}

export const presentationRoutes = [
  route({ name: "presentations.list", method: "GET", path: "/api/presentations", summary: "the decks: a project's with ?project=, every deck with ?all=1, else the workspace's" }, async (c) => {
    if (c.query.get("all") === "1") {
      const opened = await openPresentations();
      return { enabled: !opened.off && !!opened.root, ...(opened.root ? { root: opened.root } : {}), presentations: await listAllDecks(), ...(opened.error ? { error: opened.error } : {}) };
    }
    return listDecks(c.query.get("project") ?? undefined);
  }),

  route({ name: "presentations.templates", method: "GET", path: "/api/presentations/templates", summary: "the templates: the built-in one and the workspace's, with their layouts" }, async () => {
    return { templates: await listTemplates() };
  }),

  route({ name: "presentations.create", method: "POST", path: "/api/presentations", summary: "create a deck (a starter deck.md, or from `source`)", errors: presentationErrors, body: CreateFields }, async (c) => {
    await requireOn();
    const body = await c.body();
    return reply(201, await createDeck({ ...(body.project ? { project: body.project } : {}), title: body.title, ...(body.slug ? { slug: body.slug } : {}), ...(body.template ? { template: body.template } : {}), ...(body.source ? { source: body.source } : {}) }));
  }),

  route({ name: "presentations.get", method: "GET", path: "/api/presentations/:name", summary: "one deck: slides, source, layouts, warnings (?project=)", errors: presentationErrors }, async (c) => {
    await requireOn();
    const d = await getDeck(refOf(c));
    if (!d) fail(404, `no presentation "${c.params.name}"`);
    return d;
  }),

  route({ name: "presentations.save", method: "PUT", path: "/api/presentations/:name", summary: "save a deck: the whole source, or title/template/size/numbers/slides (?project=)", errors: presentationErrors, body: SaveFields }, async (c) => {
    await requireOn();
    const { slides, ...rest } = await c.body();
    try {
      return await saveDeck(refOf(c), { ...rest, ...(slides ? { slides: slides.map((s) => ({ ...s, extra: s.extra ?? {} })) } : {}) });
    } catch (err) {
      if (err instanceof StaleDeckError) throw new ApiError(409, err.message, { error: err.message, updatedAt: err.current });
      throw err;
    }
  }),

  route({ name: "presentations.delete", method: "DELETE", path: "/api/presentations/:name", summary: "move a deck to the trash (?project=)", errors: presentationErrors }, async (c) => {
    await requireOn();
    await deleteDeck(refOf(c));
    return { ok: true as const };
  }),

  // The body is the picture itself; x-file-name names it.
  route({ name: "presentations.upload", method: "POST", path: "/api/presentations/:name/assets", summary: "upload a picture into the deck's assets/ (?project=)", errors: (m) => (/^no (presentation|project)/.test(m) ? 404 : 400), upload: true }, async (c) => {
    await requireOn();
    const name = decodeURIComponent(String(c.req.headers["x-file-name"] ?? "picture.png"));
    return reply(201, await saveAsset(refOf(c), name, c.req));
  }),

  route({ name: "presentations.comment", method: "POST", path: "/api/presentations/:name/comments", summary: "comment on slide n, or one of its boxes {slide, slot?, text} (?project=)", errors: (m) => (/^no (presentation|slide|project)/.test(m) ? 404 : 400), body: z.object({ slide: z.number().int().positive(), slot: z.string().optional(), text: z.string() }) }, async (c) => {
    await requireOn();
    const body = await c.body();
    return reply(201, await addComment(refOf(c), { ...body, author: await authorOf(c.trust) }));
  }),

  route({ name: "presentations.commentSave", method: "PUT", path: "/api/presentations/:name/comments/:id", summary: "resolve or reopen a comment, or answer it {resolved?, reply?} (?project=)", errors: (m) => (/^no (presentation|project|comment)/.test(m) ? 404 : 400), body: z.object({ resolved: z.boolean().optional(), reply: z.string().optional() }) }, async (c) => {
    await requireOn();
    return updateComment(refOf(c), c.params.id, { ...(await c.body()), author: await authorOf(c.trust) });
  }),

  route({ name: "presentations.commentDelete", method: "DELETE", path: "/api/presentations/:name/comments/:id", summary: "remove a comment (?project=)", errors: (m) => (/^no (presentation|project|comment)/.test(m) ? 404 : 400) }, async (c) => {
    await requireOn();
    await deleteComment(refOf(c), c.params.id);
    return { ok: true as const };
  }),

  route({ name: "presentations.presence", method: "POST", path: "/api/presentations/:name/presence", summary: "this editor is on slide n (and box slot), or left {client, slide, slot?, leave?} → everyone on the deck; live: sub `deck.<project>/<name>` (?project=)", errors: presentationErrors, body: z.object({ client: z.string().min(1).max(64), slide: z.number().int().positive(), slot: z.string().max(64).optional(), leave: z.boolean().optional() }) }, async (c) => {
    await requireOn();
    const body = await c.body();
    const dir = await existingDeckDir(refOf(c));
    if (body.leave) {
      leavePresence(dir, body.client);
      return { viewers: [] };
    }
    return { viewers: touchPresence(dir, { client: body.client, who: await authorOf(c.trust), slide: body.slide, ...(body.slot ? { slot: body.slot } : {}) }) };
  }),

  route({ name: "presentations.history", method: "GET", path: "/api/presentations/:name/history", summary: "the deck's earlier versions, newest first (?project=)", errors: presentationErrors }, async (c) => {
    await requireOn();
    return { versions: await deckVersions(refOf(c)) };
  }),

  route({ name: "presentations.links", method: "GET", path: "/api/presentations/:name/links", summary: "the tasks that link the deck (presentation:<name> in their refs) (?project=)", errors: presentationErrors }, async (c) => {
    await requireOn();
    const ref = refOf(c);
    await existingDeckDir(ref);
    return { tasks: await tasksReferencing(`presentation:${ref.name}`) };
  }),

  route({ name: "presentations.version", method: "GET", path: "/api/presentations/:name/history/:id", summary: "one earlier version: its deck.md and the deck parsed (?project=)", errors: (m) => (/^no (presentation|project|version)/.test(m) ? 404 : 400) }, async (c) => {
    await requireOn();
    return deckVersion(refOf(c), c.params.id);
  }),

  route({ name: "presentations.templateFile", method: "GET", path: "/api/presentations/templates/:slug/file", summary: "a file of a workspace template: its fonts, its pictures (?path=)", errors: 404, raw: true }, async (c) => {
    await requireOn();
    const f = await templateFile(c.params.slug, c.query.get("path") ?? "");
    if (!f) fail(404, "no such file");
    await sendFile(c, f!);
  }),

  route({ name: "presentations.file", method: "GET", path: "/api/presentations/:name/file", summary: "a file of a deck: a picture under assets/ (?path=&project=)", errors: presentationErrors, raw: true }, async (c) => {
    await requireOn();
    const f = await deckFile(refOf(c), c.query.get("path") ?? "");
    if (!f) fail(404, "no such file");
    await sendFile(c, f!);
  }),

  route({ name: "presentations.slide", method: "GET", path: "/api/presentations/:name/slides/:n", summary: "one slide as PNG (?project=&width=1280; &hide=<slot> leaves that slot's content out)", errors: presentationErrors, raw: true }, async (c) => {
    await requireOn();
    const width = Math.min(3840, Math.max(160, Number(c.query.get("width")) || 1280));
    const png = await deckSlidePng(refOf(c), Number(c.params.n), width, c.query.get("hide") ?? undefined);
    c.res.writeHead(200, { "content-type": "image/png", "content-length": png.length, "cache-control": "private, max-age=0, must-revalidate", "x-content-type-options": "nosniff" });
    c.res.end(Buffer.from(png));
  }),

  route({ name: "presentations.export", method: "GET", path: "/api/presentations/:name/export", summary: "the deck as a file: ?format=pptx|pdf|html (?project=)", errors: presentationErrors, raw: true }, async (c) => {
    await requireOn();
    const f = c.query.get("format");
    const format = f === "pdf" || f === "html" ? f : "pptx";
    const out = await exportBytes(refOf(c), format);
    c.res.writeHead(200, {
      "content-type": out.mime,
      "content-length": out.bytes.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    });
    c.res.end(Buffer.from(out.bytes));
  }),
];
