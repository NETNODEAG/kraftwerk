import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { trustOf } from "../../src/server/trust.js";

/**
 * Who counts as this machine. A loopback peer alone is not enough: a page
 * in this machine's browser can point its own domain at 127.0.0.1 (DNS
 * rebinding — reachable whenever the server is bound to the network, where
 * any Host is served), and a reverse proxy on this machine connects from
 * loopback too. Only a loopback peer that addresses a loopback name and was
 * not forwarded is local; everyone else pairs.
 */
describe("trust", () => {
  const req = (peer: string, headers: Record<string, string>): http.IncomingMessage =>
    ({ socket: { remoteAddress: peer }, headers }) as unknown as http.IncomingMessage;
  const url = new URL("http://localhost/api/meta");
  const opts = { trustLoopback: true, trustNetwork: false };
  const kind = async (peer: string, headers: Record<string, string>, o = opts) => (await trustOf(req(peer, headers), url, o)).kind;

  it("this machine: a loopback peer addressing a loopback name", async () => {
    assert.equal(await kind("127.0.0.1", { host: "localhost:1981" }), "local");
    assert.equal(await kind("::1", { host: "[::1]:1981" }), "local");
    assert.equal(await kind("::ffff:127.0.0.1", { host: "127.0.0.1:1981" }), "local");
    assert.equal(await kind("127.0.0.1", { host: "kw.localhost:1981" }), "local");
  });

  it("not this machine: a rebound domain, a proxy's request, a network peer", async () => {
    assert.equal(await kind("127.0.0.1", { host: "evil.example:1981" }), "none", "DNS rebinding");
    assert.equal(await kind("127.0.0.1", { host: "localhost:1981", "x-forwarded-for": "203.0.113.9" }), "none", "a local reverse proxy");
    assert.equal(await kind("127.0.0.1", { host: "kw.example.com", "x-forwarded-host": "kw.example.com" }), "none");
    assert.equal(await kind("192.168.1.20", { host: "192.168.1.20:1981" }), "none", "a phone on the LAN");
  });

  it("requiring pairing trusts nobody; a container's network does", async () => {
    assert.equal(await kind("127.0.0.1", { host: "localhost:1981" }, { trustLoopback: false, trustNetwork: false }), "none");
    assert.equal(await kind("172.17.0.1", { host: "kraftwerk:1981" }, { trustLoopback: true, trustNetwork: true }), "local");
  });
});
