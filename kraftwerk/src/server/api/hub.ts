import * as z from "zod";
import { tildify } from "../../core/instances.js";
import { currentHub } from "../hub-context.js";
import { fail, route } from "./router.js";

const Root = z.object({ root: z.string().min(1, "root is required") });

/** What a hub serves (server.ts Hub): the machine's open workspaces, and opening or closing one. Need no workspace. */
export const hubRoutes = [
  // The folder is this machine's business; a paired device sees names and addresses.
  route({ name: "hub.list", method: "GET", path: "/api/hub", summary: "the workspaces this kraftwerk serves: slug, name, address" }, async (c) => {
    const hub = currentHub();
    return {
      daemon: hub.daemon,
      port: hub.port,
      workspaces: hub.list().map((o) => ({
        slug: o.slug,
        name: o.name,
        url: o.url,
        ...(o.aliasPort ? { aliasPort: o.aliasPort } : {}),
        ...(c.trust.kind === "local" ? { root: o.root, rootLabel: tildify(o.root) } : {}),
      })),
    };
  }),
  route({ name: "hub.open", method: "POST", path: "/api/hub/open", summary: "serve a workspace {root} next to the others", access: "local", body: Root, errors: 400 }, async (c) => {
    const { root } = await c.body();
    const o = await currentHub().open(root);
    return { slug: o.slug, name: o.name, url: o.url, ...(o.aliasPort ? { aliasPort: o.aliasPort } : {}) };
  }),
  route({ name: "hub.close", method: "POST", path: "/api/hub/close", summary: "stop serving a workspace {root}; the others keep running", access: "local", body: Root }, async (c) => {
    const { root } = await c.body();
    return (await currentHub().close(root)) ? { ok: true } : fail(404, "not open here");
  }),
];
