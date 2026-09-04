import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * The inspector has no login. Two guards stand in for one: only loopback
 * Host names are served (DNS rebinding), and state-changing requests must
 * carry a matching Origin when they carry one at all (CSRF).
 */
describe("request guards", () => {
  let fx: Fixture;
  let srv: RunningServer;
  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(srv.url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

  it("serves loopback Host names", async () => {
    const r = await fetch(srv.url + "/api/meta");
    assert.equal(r.status, 200);
  });

  it("refuses a Host that is not loopback (DNS rebinding)", async () => {
    // fetch drops a custom Host header, so this one goes out raw.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(srv.url + "/api/meta");
      http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: "evil.example:1981" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on("error", reject);
    });
    assert.equal(status, 421);
  });

  it("refuses a POST whose Origin does not match", async () => {
    const r = await post("/api/git/fetch", { origin: "http://attacker.localhost:1" });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "cross-origin request refused" });
  });

  it("refuses a POST the browser marks cross-site", async () => {
    const r = await post("/api/git/fetch", { origin: new URL(srv.url).origin, "sec-fetch-site": "cross-site" });
    assert.equal(r.status, 403);
  });

  it("accepts a same-origin POST and a POST without Origin", async () => {
    const same = await post("/api/git/fetch", { origin: new URL(srv.url).origin });
    assert.notEqual(same.status, 403);
    const script = await post("/api/git/fetch");
    assert.notEqual(script.status, 403);
  });

  it("matches Origin against X-Forwarded-Host behind a proxy", async () => {
    const r = await post("/api/git/fetch", { origin: "https://kw.example.com", "x-forwarded-host": "kw.example.com" });
    assert.notEqual(r.status, 403);
  });

  it("treats a default port written out by the proxy as the same host", async () => {
    const r = await post("/api/git/fetch", { origin: "https://kw.example.com", "x-forwarded-host": "kw.example.com:443" });
    assert.notEqual(r.status, 403);
    const other = await post("/api/git/fetch", { origin: "https://kw.example.com", "x-forwarded-host": "kw.example.com:8443" });
    assert.equal(other.status, 403);
  });

  it("serves a non-loopback Host when a proxy set X-Forwarded-Host", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(srv.url + "/api/meta");
      http.get(
        { host: u.hostname, port: u.port, path: u.pathname, headers: { host: "kw.example.com", "x-forwarded-host": "kw.example.com" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      ).on("error", reject);
    });
    assert.equal(status, 200);
  });
});
