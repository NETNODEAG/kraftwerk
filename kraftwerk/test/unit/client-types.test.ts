import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type ApiBody, type ApiResult } from "../../src/client/index.js";

/**
 * The client's types come from the server's routes: a body that does not
 * fit the route's schema, a missing path parameter or an unknown route
 * name do not compile. The checks are the `@ts-expect-error` lines — the
 * typecheck (`npm run typecheck`) fails if any of them stops being an
 * error. Nothing is sent: the fetch is a stub.
 */
describe("client types", () => {
  const api = createClient({ fetch: async () => new Response("{}", { status: 200 }) });

  it("types bodies, path parameters and results from the routes", async () => {
    const ok: ApiBody<"projects.log"> = { entry: "shipped" };
    await api.call("projects.log", { slug: "p", body: ok });
    // @ts-expect-error — entry must be a string
    await api.call("projects.log", { slug: "p", body: { entry: 42 } });
    // @ts-expect-error — the path parameter is required
    await assert.rejects(api.call("projects.get", {}), /missing path parameter slug/);
    // @ts-expect-error — no such route
    await assert.rejects(api.call("projects.nope"));
    const listed: ApiResult<"projects.list"> | null = null;
    assert.equal(listed, null);
  });
});
