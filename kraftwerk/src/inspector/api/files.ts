import { deleteFile, filesSummary, listFiles, listScopes, makeFolder, moveFile, openFile, saveUpload } from "../files.js";
import { reply, route, type Ctx } from "./router.js";

const errors = (message: string): number => (/^no (file|folder|project)/.test(message) ? 404 : 400);
/** The scope (workspace, or a project's folder) and the path inside it, from the query. */
const where = (c: Ctx): [string, string] => [c.query.get("scope") ?? "workspace", c.query.get("path") ?? ""];

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
  route({ name: "files.mkdir", method: "POST", path: "/api/files/folder", summary: "create a folder {scope, path}", errors }, async (c) => {
    const body = await c.body<{ scope?: string; path?: string }>();
    return reply(201, await makeFolder(body.scope ?? where(c)[0], String(body.path ?? "")));
  }),
  route({ name: "files.move", method: "POST", path: "/api/files/move", summary: "move or rename {scope, from, to}", errors }, async (c) => {
    const body = await c.body<{ scope?: string; from?: string; to?: string }>();
    await moveFile(body.scope ?? where(c)[0], String(body.from ?? ""), String(body.to ?? ""));
    return { ok: true };
  }),
  route({ name: "files.delete", method: "DELETE", path: "/api/files", summary: "move a file or folder ?scope&path to the trash", errors }, async (c) => {
    await deleteFile(...where(c));
    return { ok: true };
  }),
];
