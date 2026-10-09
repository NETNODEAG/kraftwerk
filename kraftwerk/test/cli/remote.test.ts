import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cli } from "../helpers/cli.js";

/**
 * `kraftwerk remote`: the machine's relay settings (~/.kraftwerk/relay.json,
 * owner-only, its key made once) and the pairing link. No daemon runs here,
 * so nothing connects anywhere.
 */
describe("kraftwerk remote", () => {
  let home = "";
  const settings = async () => JSON.parse(await readFile(path.join(home, ".kraftwerk", "relay.json"), "utf8")) as { enabled: boolean; url: string; publicKey: string; secret: string };

  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "kw-remote-"));
  });
  after(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("is off until turned on; pairing needs it on", async () => {
    const r = await cli(home, home, ["remote"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /off/);
    const pair = await cli(home, home, ["remote", "pair"]);
    assert.equal(pair.code, 1);
    assert.match(pair.all, /remote on/);
  });

  it("on makes the machine key once, owner-only, and keeps it across off/on", async () => {
    const on = await cli(home, home, ["remote", "on", "--url", "https://cloud.example.test"]);
    assert.equal(on.code, 0, on.all);
    assert.match(on.stdout, /remote access on through https:\/\/cloud\.example\.test/);
    assert.match(on.stdout, /daemon is not running/);
    const first = await settings();
    assert.equal(first.enabled, true);
    assert.equal(first.url, "https://cloud.example.test");
    assert.equal((await stat(path.join(home, ".kraftwerk", "relay.json"))).mode & 0o777, 0o600);

    assert.equal((await cli(home, home, ["remote", "off"])).code, 0);
    assert.equal((await settings()).enabled, false);
    assert.equal((await cli(home, home, ["remote", "on"])).code, 0);
    const again = await settings();
    assert.equal(again.publicKey, first.publicKey, "the same machine: paired links keep working");
    assert.equal(again.secret, first.secret);
    assert.equal(again.url, "https://cloud.example.test", "the relay stays where it was set");
  });

  it("pair prints a link to the remote page with the key and a code in the fragment", async () => {
    const r = await cli(home, home, ["remote", "pair"]);
    assert.equal(r.code, 0, r.all);
    const link = /https:\/\/\S+/.exec(r.stdout)?.[0] ?? "";
    const u = new URL(link);
    assert.equal(u.origin, "https://remote.cloud.example.test");
    assert.equal(u.pathname, "/_kw/");
    const frag = new URLSearchParams(u.hash.slice(1));
    assert.equal(frag.get("k"), (await settings()).publicKey);
    assert.match(frag.get("c") ?? "", /^[A-Z0-9]{8}$/);
    assert.equal(u.search, "", "nothing secret in what a server sees");
  });
});
