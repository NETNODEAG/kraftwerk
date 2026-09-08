import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * kraftwerk.yml `public` + `tunnel.access`: the loopback bind serves the
 * public hostname without X-Forwarded-Host (a Cloudflare Tunnel sends
 * none), and every request that arrives via that hostname must carry a
 * valid Cloudflare Access token. A local JWKS server stands in for
 * <team>.cloudflareaccess.com; the tokens are signed here.
 */
const TEAM = "acme";
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const PUBLIC = "kw.example.com";

const CONFIG =
  `name: fixture\ngit:\n  interval: 0\npublic: https://${PUBLIC}\n` +
  `tunnel:\n  name: kraftwerk\n  access:\n    team: ${TEAM}\n    aud: ${AUD}\n`;

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");

function makeKey(kid: string): { kid: string; priv: KeyObject; jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, use: "sig", alg: "RS256" };
  return { kid, priv: privateKey, jwk };
}

function token(key: { kid: string; priv: KeyObject }, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://${TEAM}.cloudflareaccess.com`, aud: [AUD], exp: now + 300, iat: now, email: "lukas@example.com", ...claims };
  const data = `${b64({ alg: "RS256", kid: key.kid, typ: "JWT" })}.${b64(payload)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key.priv).toString("base64url")}`;
}

describe("public hostname + Cloudflare Access", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let jwks: http.Server;
  let keys = [makeKey("key-1")];
  let certsFetches = 0;

  before(async () => {
    jwks = http.createServer((_req, res) => {
      certsFetches++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: keys.map((k) => k.jwk) }));
    });
    await new Promise<void>((r) => jwks.listen(0, "127.0.0.1", r));
    process.env.KRAFTWERK_ACCESS_CERTS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/certs`;
    fx = await makeProject(CONFIG);
    srv = await startServer(fx);
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACCESS_CERTS_URL;
    await srv.close();
    await new Promise<void>((r) => jwks.close(() => r()));
    await fx.cleanup();
  });

  /** A raw request (fetch drops a custom Host header). */
  const raw = (
    path: string,
    headers: Record<string, string>,
    method = "GET"
  ): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const u = new URL(srv.url + path);
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(method === "POST" ? "{}" : undefined);
    });

  it("serves the public Host without X-Forwarded-Host when the token is valid", async () => {
    const r = await raw("/api/meta", { host: PUBLIC, "cf-access-jwt-assertion": token(keys[0]) });
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).publicUrl, `https://${PUBLIC}`);
  });

  it("refuses the public Host without a token", async () => {
    const r = await raw("/api/meta", { host: PUBLIC });
    assert.equal(r.status, 401);
    assert.deepEqual(JSON.parse(r.body), { error: "Cloudflare Access token missing" });
  });

  it("refuses expired, mis-audienced, mis-issued and forged tokens", async () => {
    const cases: Array<[string, string]> = [
      [token(keys[0], { exp: Math.floor(Date.now() / 1000) - 1 }), "token expired"],
      [token(keys[0], { aud: ["0".repeat(64)] }), "wrong audience"],
      [token(keys[0], { iss: "https://other.cloudflareaccess.com" }), "wrong issuer"],
      [token(makeKey("key-1")), "bad signature"],
      ["not.a.token", "malformed token"],
    ];
    for (const [t, reason] of cases) {
      const r = await raw("/api/meta", { host: PUBLIC, "cf-access-jwt-assertion": t });
      assert.equal(r.status, 401, reason);
      assert.deepEqual(JSON.parse(r.body), { error: `Cloudflare Access token refused: ${reason}` });
    }
  });

  it("picks up a rotated signing key", async () => {
    const before = certsFetches;
    keys = [makeKey("key-2")];
    const r = await raw("/api/meta", { host: PUBLIC, "cf-access-jwt-assertion": token(keys[0]) });
    assert.equal(r.status, 200, r.body);
    assert.equal(certsFetches, before + 1);
  });

  it("still serves loopback Hosts without a token", async () => {
    const r = await fetch(srv.url + "/api/meta");
    assert.equal(r.status, 200);
  });

  it("still refuses any other non-loopback Host", async () => {
    const r = await raw("/api/meta", { host: "evil.example", "cf-access-jwt-assertion": token(keys[0]) });
    assert.equal(r.status, 421);
  });

  it("accepts a POST whose Origin is the public hostname", async () => {
    const r = await raw(
      "/api/git/fetch",
      { host: PUBLIC, origin: `https://${PUBLIC}`, "content-type": "application/json", "cf-access-jwt-assertion": token(keys[0]) },
      "POST"
    );
    assert.notEqual(r.status, 403, r.body);
    assert.notEqual(r.status, 401, r.body);
  });
});
