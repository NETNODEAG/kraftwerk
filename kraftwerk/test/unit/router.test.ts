import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as z from "zod";
import { createRouter, fail, reply, route, statusByMessage } from "../../src/server/api/router.js";

/**
 * The API router: literal segments win over parameters, parameters arrive
 * decoded, a handler's return value is the 200 body (or a Reply's status),
 * a malformed body or path is a 400, thrown errors map by the route's
 * `errors`, and an unknown method or path is a 404.
 */
describe("api router", () => {
  const router = createRouter([
    route({ name: "things.get", method: "GET", path: "/api/things/:slug", summary: "" }, async (c) => ({ slug: c.params.slug, q: c.query.get("q") })),
    route({ name: "things.special", method: "GET", path: "/api/things/special", summary: "" }, async () => ({ special: true })),
    route({ name: "things.create", method: "POST", path: "/api/things", summary: "" }, async (c) => reply(201, await c.body())),
    route({ name: "things.refuse", method: "POST", path: "/api/things/:slug/refuse", summary: "" }, async () => fail(409, "busy")),
    route({ name: "things.mapped", method: "POST", path: "/api/things/:slug/mapped", summary: "", errors: statusByMessage(/^no thing/) }, async (c) => {
      throw new Error(c.params.slug === "gone" ? "no thing gone" : "things are off");
    }),
    route({ name: "things.crash", method: "POST", path: "/api/things/:slug/crash", summary: "" }, async () => {
      throw new Error("boom");
    }),
    route(
      { name: "things.typed", method: "POST", path: "/api/things/:slug/typed", summary: "", body: z.object({ title: z.string(), count: z.number().default(1) }) },
      async (c) => {
        const body = await c.body();
        return { title: body.title.toUpperCase(), count: body.count };
      },
    ),
  ]);
  let base = "";
  const server = http.createServer((req, res) => void router.handle(req, res, new URL(req.url ?? "/", "http://localhost")));
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const call = async (method: string, p: string, body?: string) => {
    const r = await fetch(base + p, { method, body });
    return { status: r.status, body: await r.json() };
  };

  it("prefers a literal segment over a parameter and decodes parameters", async () => {
    assert.deepEqual(await call("GET", "/api/things/special"), { status: 200, body: { special: true } });
    assert.deepEqual(await call("GET", "/api/things/a%20b?q=1"), { status: 200, body: { slug: "a b", q: "1" } });
    assert.equal((await call("GET", "/api/things/%E0%A4%A")).status, 400);
  });

  it("reads JSON bodies: empty is {}, malformed is a 400", async () => {
    assert.deepEqual(await call("POST", "/api/things", '{"a":1}'), { status: 201, body: { a: 1 } });
    assert.deepEqual(await call("POST", "/api/things"), { status: 201, body: {} });
    assert.deepEqual(await call("POST", "/api/things", "{nope"), { status: 400, body: { error: "invalid JSON body" } });
  });

  it("maps refusals and errors to statuses", async () => {
    assert.deepEqual(await call("POST", "/api/things/x/refuse"), { status: 409, body: { error: "busy" } });
    assert.equal((await call("POST", "/api/things/gone/mapped")).status, 404);
    assert.equal((await call("POST", "/api/things/x/mapped")).status, 409);
    assert.deepEqual(await call("POST", "/api/things/x/crash"), { status: 500, body: { error: "boom" } });
  });

  it("validates a body against the route's schema: defaults applied, a mismatch is a 400 naming the field", async () => {
    assert.deepEqual(await call("POST", "/api/things/x/typed", '{"title":"hi"}'), { status: 200, body: { title: "HI", count: 1 } });
    const bad = await call("POST", "/api/things/x/typed", '{"title":3}');
    assert.equal(bad.status, 400);
    assert.match((bad.body as { error: string }).error, /expected string[\s\S]*title/);
    assert.equal((await call("POST", "/api/things/x/typed")).status, 400, "an empty body is {} and still has to fit");
  });

  it("validates bodies of routes run without HTTP too (the socket)", async () => {
    assert.deepEqual(await router.invoke("things.typed", { slug: "x", body: { title: "a", count: 5 } }), { status: 200, data: { title: "A", count: 5 } });
    assert.equal((await router.invoke("things.typed", { slug: "x", body: { title: 1 } })).status, 400);
  });

  it("answers 404 for an unknown path or method", async () => {
    assert.deepEqual(await call("GET", "/api/nothing"), { status: 404, body: { error: "not found" } });
    assert.equal((await call("DELETE", "/api/things/special")).status, 404);
  });

  it("refuses two routes with one name", () => {
    const r = route({ name: "dup", method: "GET", path: "/a", summary: "" }, async () => 1);
    assert.throws(() => createRouter([r, { ...r, path: "/b" }]), /duplicate route name dup/);
  });
});
