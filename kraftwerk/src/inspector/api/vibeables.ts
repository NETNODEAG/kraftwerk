import { createVibeable, deleteVibeable, listVibeables, openVibeables, resolveVibeable, startDev, stopDev, subscribeVibeable, vibeableStatus, type VibeableEvent } from "../vibeables.js";
import { fail, reply, route, statusByMessage } from "./router.js";

const errors = statusByMessage(/^no vibeable/);

/** Apps (vibeables): folders under the vibeables root, previewed in the chat. */
export const vibeableRoutes = [
  route({ name: "vibeables.list", method: "GET", path: "/api/vibeables", summary: "every app folder under the vibeables root" }, async () => listVibeables()),
  route({ name: "vibeables.create", method: "POST", path: "/api/vibeables", summary: "create one {name} from the starter", errors: 400 }, async (c) => {
    if ((await openVibeables()).off) fail(409, "vibeables are off");
    const body = await c.body<{ name?: unknown }>();
    return reply(201, await createVibeable(typeof body.name === "string" ? body.name : ""));
  }),
  route({ name: "vibeables.get", method: "GET", path: "/api/vibeables/:slug", summary: "how the app previews: mode, static url, dev server state", errors }, async (c) =>
    vibeableStatus(c.params.slug),
  ),
  route({ name: "vibeables.delete", method: "DELETE", path: "/api/vibeables/:slug", summary: "remove the folder", errors }, async (c) => {
    await deleteVibeable(c.params.slug);
    return { ok: true };
  }),
  route({ name: "vibeables.devStart", method: "POST", path: "/api/vibeables/:slug/dev/start", summary: "start the app's dev command", errors }, async (c) => startDev(c.params.slug)),
  route({ name: "vibeables.devStop", method: "POST", path: "/api/vibeables/:slug/dev/stop", summary: "stop the app's dev command", errors }, async (c) => stopDev(c.params.slug)),
  route(
    { name: "vibeables.events", method: "GET", path: "/api/vibeables/:slug/events", summary: "SSE: file changes (debounced) and dev-server state", errors, raw: true },
    async ({ req, res, params }) => {
      const { dir } = await resolveVibeable(params.slug);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(":ok\n\n");
      const unsubscribe = subscribeVibeable(params.slug, dir, (ev: VibeableEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
      const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  ),
];
