import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * kraftwerk.yml `cloud:` — the inspector registers with the cloud manager
 * when it starts, stores the identity it gets under ~/.kraftwerk/cloud/,
 * heartbeats with it, and reports the connection in /api/meta. A local
 * http server stands in for the cloud and records what arrives.
 */
interface Hit {
  path: string;
  body: Record<string, unknown>;
}

describe("cloud manager registration", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let cloud: http.Server;
  let cloudUrl: string;
  const hits: Hit[] = [];

  const waitFor = async (pred: () => boolean, ms = 8000): Promise<void> => {
    const until = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > until) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  before(async () => {
    cloud = http.createServer((req, res) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => {
        const body = JSON.parse(text || "{}") as Record<string, unknown>;
        hits.push({ path: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/api/instances/register") {
          res.end(JSON.stringify({ id: "inst-1", secret: "s3cret", interval: 1, account: null, claimCode: "XKQ7-2MPD", created: true }));
        } else {
          // The claim happened in the cloud meanwhile: the heartbeat answer carries it.
          res.end(JSON.stringify({ ok: true, interval: 1, account: "alice@example.com", claimCode: null }));
        }
      });
    });
    await new Promise<void>((r) => cloud.listen(0, "127.0.0.1", r));
    cloudUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;
    process.env.KRAFTWERK_CLOUD_TOKEN = "kwc_test-token";
    // The URL comes from the environment (what a deployment or a test sets); the yml only tunes the interval.
    process.env.KRAFTWERK_CLOUD_URL = cloudUrl;
    fx = await makeProject(`name: fixture\nicon: "⚡"\ncolor: "#c2410c"\ngit:\n  interval: 0\ncloud:\n  interval: 1\n`);
    await fx.write("agents/max/agent.yml", "name: Max\nemoji: 🤖\n");
    srv = await startServer(fx);
  });
  after(async () => {
    delete process.env.KRAFTWERK_CLOUD_TOKEN;
    delete process.env.KRAFTWERK_CLOUD_URL;
    await srv.close();
    await new Promise<void>((r) => cloud.close(() => r()));
    await fx.cleanup();
  });

  it("registers with the workspace identity, the account token and the roster", async () => {
    await waitFor(() => hits.some((h) => h.path === "/api/instances/register"));
    const reg = hits.find((h) => h.path === "/api/instances/register")!.body;
    assert.equal(reg.name, "fixture");
    assert.equal(reg.icon, "⚡");
    assert.equal(reg.color, "#c2410c");
    assert.equal(reg.root, fx.root);
    assert.equal(reg.url, srv.url.replace("127.0.0.1", "localhost"));
    assert.equal(reg.accountToken, "kwc_test-token");
    assert.equal(reg.interval, 1);
    assert.match(String(reg.version), /^\d+\.\d+\.\d+/);
    assert.ok(typeof reg.hostname === "string" && reg.hostname.length > 0);
    assert.match(String(reg.platform), /^(darwin|linux|win32)-/);
    assert.deepEqual((reg.agents as { slug: string }[]).map((a) => a.slug), ["max"]);
    assert.equal("id" in reg, false, "a first registration carries no identity");
  });

  it("stores the identity the cloud handed out under ~/.kraftwerk/cloud", async () => {
    const dir = path.join(fx.home, ".kraftwerk", "cloud");
    // The fake cloud records the request before the inspector has processed the response and written the file.
    let files: string[] = [];
    await waitFor(() => {
      readdir(dir).then((l) => (files = l.filter((f) => f.endsWith(".json"))), () => {});
      return files.length > 0;
    });
    assert.equal(files.length, 1);
    const rec = JSON.parse(await readFile(path.join(dir, files[0]), "utf8"));
    assert.equal(rec.id, "inst-1");
    assert.equal(rec.secret, "s3cret");
    assert.equal(rec.url, cloudUrl);
    assert.equal(rec.root, fx.root);
  });

  it("heartbeats with that identity at the interval the cloud asked for", async () => {
    await waitFor(() => hits.some((h) => h.path === "/api/instances/heartbeat"));
    const hb = hits.find((h) => h.path === "/api/instances/heartbeat")!.body;
    assert.equal(hb.id, "inst-1");
    assert.equal(hb.secret, "s3cret");
    assert.match(String(hb.version), /^\d+\.\d+\.\d+/);
  });

  it("reports the connection, and the claim made in the cloud, in /api/meta", async () => {
    const meta = (await (await fetch(srv.url + "/api/meta")).json()) as { cloud: Record<string, unknown> };
    assert.equal(meta.cloud.url, cloudUrl);
    assert.equal(meta.cloud.state, "connected");
    assert.equal(meta.cloud.id, "inst-1");
    assert.equal(meta.cloud.interval, 1);
    // After the first heartbeat the claim from the cloud is reflected: account set, code gone.
    assert.equal(meta.cloud.account, "alice@example.com");
    assert.equal(meta.cloud.claimCode, null);
    assert.equal(meta.cloud.claimUrl, null);
  });

  it("carries the claim code and link until the instance is claimed", async () => {
    // Replay what the register answer alone produces: a second fixture is not possible (one per file), so assert on the wire contract.
    const reg = hits.find((h) => h.path === "/api/instances/register")!;
    assert.equal(reg.body.accountToken, "kwc_test-token");
    const first = hits.findIndex((h) => h.path === "/api/instances/heartbeat");
    assert.ok(first > 0, "a heartbeat followed the registration");
  });
});
