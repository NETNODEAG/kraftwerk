import * as z from "zod";
import { deleteFile, filesSummary, listFiles, listScopes, makeFolder, moveFile, openFile, saveUpload } from "../../core/files.js";
import { cleanTemp, listTemp } from "../../core/temp.js";
import { tildify } from "../../core/instances.js";
import { reply, route, type Ctx } from "./router.js";

const errors = (message: string): number => (/^no (file|folder|project)/.test(message) ? 404 : 400);
/** The scope (workspace, or a project's folder) and the path inside it, from the query. */
const where = (c: Ctx): [string, string] => [c.query.get("scope") ?? "workspace", c.query.get("path") ?? ""];

/** A folder to create; the scope falls back to the query's. Paths are checked by the domain. */
const Folder = z.object({ scope: z.string().optional(), path: z.string().default("") });
/** A move or rename inside one scope; the scope falls back to the query's. */
const Move = z.object({ scope: z.string().optional(), from: z.string().default(""), to: z.string().default("") });

/** Files: the workspace's folder and one per project, browsed by scope and path. */
export const fileRoutes = [
  route({ name: "files.scopes", method: "GET", path: "/api/files", summary: "the roots: the workspace and one per project", errors }, async () => ({ scopes: await listScopes() })),
  route({ name: "files.list", method: "GET", path: "/api/files/list", summary: "a folder's entries ?scope&path", errors }, async (c) => listFiles(...where(c))),
  route({ name: "files.recent", method: "GET", path: "/api/files/recent", summary: "the scope's file count and latest files ?scope", errors }, async (c) =>
    (await filesSummary(where(c)[0], 5)) ?? { root: "", count: 0, recent: [] },
  ),
  route({ name: "files.raw", method: "GET", path: "/api/files/raw", summary: "the file itself ?scope&path[&download=1]", errors, raw: true }, async (c) => {
    const f = await openFile(...where(c));
    c.res.writeHead(200, {
      "content-type": f.mime,
      "content-length": f.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // Anything in here may come from outside: a page, an SVG or XML renders without scripts, in an origin of its own.
      // (Not on PDFs and media: a sandboxed document cannot show the browser's PDF viewer.)
      ...(/^(text\/html|image\/svg|text\/xml|application\/xml)/.test(f.mime) ? { "content-security-policy": "sandbox" } : {}),
      "content-disposition": `${c.query.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    });
    f.stream.pipe(c.res);
  }),
  // The body is the file itself; x-file-name names it.
  route({ name: "files.upload", method: "POST", path: "/api/files/upload", summary: "upload one file ?scope&path", errors, upload: true }, async (c) => {
    const name = decodeURIComponent(String(c.req.headers["x-file-name"] ?? "file"));
    return reply(201, await saveUpload(...where(c), name, c.req));
  }),
  route({ name: "files.mkdir", method: "POST", path: "/api/files/folder", summary: "create a folder {scope, path}", errors, body: Folder }, async (c) => {
    const body = await c.body();
    return reply(201, await makeFolder(body.scope ?? where(c)[0], body.path));
  }),
  route({ name: "files.move", method: "POST", path: "/api/files/move", summary: "move or rename {scope, from, to}", errors, body: Move }, async (c) => {
    const body = await c.body();
    await moveFile(body.scope ?? where(c)[0], body.from, body.to);
    return { ok: true };
  }),
  route({ name: "files.delete", method: "DELETE", path: "/api/files", summary: "move a file or folder ?scope&path to the trash", errors }, async (c) => {
    await deleteFile(...where(c));
    return { ok: true };
  }),

  // The temp root: one scratch folder per session (core/temp.ts). Nothing in it is a deliverable, so a clean deletes for good.
  route({ name: "temp.list", method: "GET", path: "/api/temp", summary: "the sessions' scratch folders, newest first", errors }, async () => {
    const view = await listTemp();
    return { ...view, root: tildify(view.root) };
  }),
  route({ name: "temp.clean", method: "DELETE", path: "/api/temp", summary: "remove scratch folders idle a week ?olderThanDays, or every one ?all=1", errors }, async (c) => {
    const raw = c.query.get("olderThanDays");
    const days = raw === null ? NaN : Number(raw);
    const gone = await cleanTemp({ all: c.query.get("all") === "1", ...(Number.isFinite(days) && days >= 0 ? { olderThanMs: days * 24 * 60 * 60 * 1000 } : {}) });
    return { ok: true, removed: gone.map((e) => e.id), bytes: gone.reduce((n, e) => n + e.bytes, 0) };
  }),
];
