import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** `kraftwerk whoami`: this machine's handle@machine in ~/.kraftwerk/identity.json, renamed with --handle / --machine. */
describe("kraftwerk whoami", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const file = () => path.join(dir.home, ".kraftwerk", "identity.json");
  type Id = { handle: string; machine: string; identity: string; previous: string[] };

  before(async () => {
    dir = await makeEmptyDir();
  });
  after(() => dir.cleanup());

  it("prints handle, machine and the identity; the defaults are written on first use", async () => {
    const r = await cli(dir.root, dir.home, ["whoami"]);
    assert.equal(r.code, 0, r.all);
    const id = json<Id>(await cli(dir.root, dir.home, ["whoami", "--json"]));
    assert.match(r.stdout, new RegExp(`handle: +${id.handle}\\n`));
    assert.match(r.stdout, new RegExp(`machine: +${id.machine}\\n`));
    assert.match(r.stdout, new RegExp(`identity: +${id.handle}@${id.machine}`));
    assert.equal(id.identity, `${id.handle}@${id.machine}`);
    assert.deepEqual(JSON.parse(await readFile(file(), "utf8")), { handle: id.handle, machine: id.machine, previous: [] });
  });

  it("--handle / --machine rename; the retired pair goes to previous", async () => {
    const r = await cli(dir.root, dir.home, ["whoami", "--handle", "lukas", "--machine", "mbp"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /→ lukas@mbp/);
    const first = json<Id>(await cli(dir.root, dir.home, ["whoami", "--json"]));
    assert.equal(first.identity, "lukas@mbp");
    assert.equal(first.previous.length, 1);

    const again = await cli(dir.root, dir.home, ["whoami", "--machine", "studio"]);
    assert.match(again.stdout, /lukas@mbp → lukas@studio/);
    assert.match(again.stdout, /previous: .*lukas@mbp/);
    assert.match(again.stdout, /doctor --fix/);
    const id = json<Id>(await cli(dir.root, dir.home, ["whoami", "--json"]));
    assert.equal(id.identity, "lukas@studio");
    assert.deepEqual(id.previous.slice(-1), ["lukas@mbp"]);
    assert.deepEqual(JSON.parse(await readFile(file(), "utf8")).previous, id.previous);
  });

  it("refuses a name with @, uppercase or nothing, and changes nothing", async () => {
    for (const args of [["--handle", "a@b"], ["--machine", "Studio"], ["--handle", ""]]) {
      const r = await cli(dir.root, dir.home, ["whoami", ...args]);
      assert.equal(r.code, 2, `${args.join(" ")}: ${r.all}`);
    }
    assert.equal(json<Id>(await cli(dir.root, dir.home, ["whoami", "--json"])).identity, "lukas@studio");
  });

  it("daemon status names the identity", async () => {
    // A free port with nothing on it: the private HOME has no daemon, and the real one must not answer.
    const port = await new Promise<number>((resolve) => {
      const s = http.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const r = await cli(dir.root, dir.home, ["daemon", "status"], { env: { KRAFTWERK_DAEMON_PORT: String(port) } });
    assert.equal(r.code, 3, r.all);
    assert.match(r.stdout, /identity: lukas@studio/);
    const j = await cli(dir.root, dir.home, ["daemon", "status", "--json"], { env: { KRAFTWERK_DAEMON_PORT: String(port) } });
    assert.equal(JSON.parse(j.stdout).identity, "lukas@studio");
  });
});
