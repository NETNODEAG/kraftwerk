import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/** kraftwerk.yml `public` + `tunnel`: what doctor accepts, refuses and warns about. */
describe("kraftwerk.yml public + tunnel", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  const doctor = async (config: string, env: Record<string, string> = {}) => {
    await fx.write("kraftwerk.yml", `name: fixture\n${config}`);
    return cli(fx.root, fx.home, ["doctor"], { env });
  };

  it("refuses malformed values", async () => {
    const cases: Array<[string, RegExp]> = [
      ["public: https://kw.example.com/ui\n", /public must be a hostname or https URL/],
      ["public: 42\n", /public must be a hostname or https URL/],
      ["public: kw.example.com\ntunnel:\n  name: \"--bad\"\n", /tunnel\.name must be a plain tunnel name/],
      ["public: kw.example.com\ntunnel:\n  url: x\n", /tunnel\.url is unknown/],
      ["public: kw.example.com\ntunnel:\n  access:\n    team: acme\n    aud: short\n", /tunnel\.access\.aud must be the 64-character/],
      ["public: kw.example.com\ntunnel:\n  access:\n    team: \"acme.cloudflareaccess.com\"\n    aud: " + "a".repeat(64) + "\n", /tunnel\.access\.team must be the Zero Trust team name/],
      ["tunnel:\n  name: kraftwerk\n", /tunnel needs public/],
    ];
    for (const [config, error] of cases) {
      const r = await doctor(config);
      assert.equal(r.code, 1, config);
      assert.match(r.stdout, error, config);
    }
  });

  it("public without tunnel is informational; a disabled tunnel needs no public", async () => {
    const r = await doctor("public: https://kw.example.com\n");
    assert.match(r.stdout, /• public: kw\.example\.com — served when a tunnel or reverse proxy delivers that Host/);
    assert.doesNotMatch(r.stdout, /tunnel[:.]/);
    const off = await doctor("tunnel:\n  enabled: false\n  name: kraftwerk\n");
    assert.doesNotMatch(off.stdout, /kraftwerk\.yml invalid/);
  });

  it("a tunnel without a name or TUNNEL_TOKEN has nothing to run; without access it warns", async () => {
    const r = await doctor("public: kw.example.com\ntunnel:\n", { TUNNEL_TOKEN: "" });
    assert.match(r.stdout, /✖ tunnel: nothing to run — set tunnel\.name .* or the TUNNEL_TOKEN env var/);
    assert.match(r.stdout, /⚠ tunnel without access — the UI has no login of its own/);
    assert.equal(r.code, 1);
  });

  it("a named tunnel with access reports what will run", async () => {
    const r = await doctor(
      "port: 1985\npublic: https://kw.example.com\ntunnel:\n  name: kraftwerk\n  access:\n    team: acme\n    aud: " + "0a1b2c3d".repeat(8) + "\n"
    );
    assert.match(r.stdout, /tunnel: kraftwerk → kw\.example\.com — cloudflared tunnel run --url http:\/\/127\.0\.0\.1:1985 kraftwerk/);
    assert.match(r.stdout, /✔ tunnel\.access — tokens verified against acme\.cloudflareaccess\.com/);
    assert.doesNotMatch(r.stdout, /tunnel without access/);
    // A dashboard-managed tunnel is fine as long as the token is in the environment.
    const dash = await doctor("public: kw.example.com\ntunnel:\n", { TUNNEL_TOKEN: "eyJ-token" });
    assert.match(dash.stdout, /✔ tunnel: dashboard-managed → kw\.example\.com — TUNNEL_TOKEN is set/);
  });
});

/**
 * `kraftwerk tunnel` and `kraftwerk tunnel setup`: driven against a fake
 * cloudflared on PATH that records its arguments and answers like the real
 * one. Real tunnels need a Cloudflare login, so the contract under test is
 * what kraftwerk asks cloudflared to do and what it writes to kraftwerk.yml.
 */
describe("kraftwerk tunnel", () => {
  let fx: Fixture;
  let bin: string;
  let argsLog: string;

  /** A fake cloudflared: logs every call, behaves per FAKE_CF_MODE. */
  const FAKE = `#!/bin/sh
echo "$@" >> "$FAKE_CF_LOG"
case "$1 $2" in
  "--version ") echo "cloudflared version 2025.11.1 (fake)";;
  "tunnel login") mkdir -p "$HOME/.cloudflared" && echo cert > "$HOME/.cloudflared/cert.pem";;
  "tunnel list") if [ "$FAKE_CF_MODE" = "existing" ]; then echo '[{"id":"11111111-2222-3333-4444-555555555555","name":"'"$6"'"}]'; else echo '[]'; fi;;
  "tunnel create") echo '{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"'"$5"'"}';;
  "tunnel route")
    host="$5"; [ "$4" = "--overwrite-dns" ] && host="$6"
    if [ "$FAKE_CF_MODE" = "wrong-zone" ]; then echo "Added CNAME $host.other.zone which will route to this tunnel tunnelID=x" >&2
    elif [ "$FAKE_CF_MODE" = "exists" ] && [ "$4" != "--overwrite-dns" ]; then echo "Failed to add route: code: 1003, reason: An A, AAAA, or CNAME record with that host already exists." >&2; exit 1
    else echo "Added CNAME $host which will route to this tunnel tunnelID=x" >&2; fi;;
  "tunnel --no-autoupdate") echo "fake run failed" >&2; exit 1;;
esac
`;

  before(async () => {
    fx = await makeProject("name: Agent Playground\nport: 1985\n");
    bin = path.join(fx.home, "bin");
    argsLog = path.join(fx.home, "cloudflared.log");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "cloudflared"), FAKE, { mode: 0o755 });
  });
  after(() => fx.cleanup());

  const run = async (args: string[], env: Record<string, string> = {}) => {
    await rm(argsLog, { force: true });
    const r = await cli(fx.root, fx.home, ["tunnel", ...args], { env: { PATH: `${bin}:${process.env.PATH}`, FAKE_CF_LOG: argsLog, FAKE_CF_MODE: "", ...env } });
    const calls = existsSync(argsLog) ? (await readFile(argsLog, "utf8")).trim().split("\n") : [];
    return { ...r, calls };
  };

  it("setup refuses bad input before touching cloudflared", async () => {
    const bad = await run(["setup", "https://kw.example.com/path"]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /is not a hostname/);
    assert.deepEqual(bad.calls, []);
    const name = await run(["setup", "kw.example.com", "--name", "--evil"]);
    assert.equal(name.code, 2);
    assert.match(name.stderr, /not a plain tunnel name/);
  });

  it("setup needs cloudflared on PATH", async () => {
    const r = await run(["setup", "kw.example.com"], { PATH: "/nonexistent" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cloudflared not found/);
  });

  it("setup logs in, creates the tunnel, routes the hostname and writes kraftwerk.yml", async () => {
    const r = await run(["setup", "https://kw.example.com"]);
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(r.calls, [
      "--version",
      "tunnel login",
      "tunnel list --output json --name kraftwerk-agent-playground",
      "tunnel create --output json kraftwerk-agent-playground",
      "tunnel route dns kraftwerk-agent-playground kw.example.com",
    ]);
    assert.match(r.stdout, /✔ created tunnel kraftwerk-agent-playground aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
    assert.match(r.stdout, /✔ kw\.example\.com → tunnel kraftwerk-agent-playground/);
    assert.match(r.stdout, /Access policy on kw\.example\.com/);
    const yml = await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8");
    assert.equal(yml, "name: Agent Playground\nport: 1985\npublic: https://kw.example.com\ntunnel:\n  name: kraftwerk-agent-playground\n");
    // The config is valid as written: doctor reads it back.
    const doctor = await cli(fx.root, fx.home, ["doctor"], { env: { PATH: `${bin}:${process.env.PATH}` } });
    assert.match(doctor.stdout, /tunnel: kraftwerk-agent-playground → kw\.example\.com — cloudflared tunnel run --url http:\/\/127\.0\.0\.1:1985 kraftwerk-agent-playground/);
  });

  it("setup reuses the login and an existing tunnel, keeps an access block, honours --name", async () => {
    await fx.write("kraftwerk.yml", "name: Agent Playground\nport: 1985\n# keep me\ntunnel:\n  enabled: false\n  access:\n    team: acme\n    aud: " + "0a1b2c3d".repeat(8) + "\n");
    const r = await run(["setup", "kw.example.com", "--name", "shared"], { FAKE_CF_MODE: "existing" });
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(r.calls, ["--version", "tunnel list --output json --name shared", "tunnel route dns shared kw.example.com"]);
    assert.match(r.stdout, /✔ tunnel shared exists 11111111-2222-3333-4444-555555555555/);
    const yml = await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8");
    assert.match(yml, /# keep me/);
    assert.match(yml, /public: https:\/\/kw\.example\.com/);
    assert.match(yml, /tunnel:\n  access:\n    team: acme\n    aud: 0a1b2c3d/);
    assert.match(yml, /  name: shared\n/);
    assert.doesNotMatch(yml, /enabled: false/);
  });

  it("setup refuses a hostname that cloudflared routed into another zone", async () => {
    const r = await run(["setup", "kw.example.com"], { FAKE_CF_MODE: "wrong-zone" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /routed kw\.example\.com\.other\.zone instead of kw\.example\.com/);
    assert.match(r.stderr, /Delete the stray CNAME kw\.example\.com\.other\.zone/);
  });

  it("setup explains an existing DNS record and --overwrite-dns replaces it", async () => {
    const r = await run(["setup", "kw.example.com"], { FAKE_CF_MODE: "exists" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /run setup again with --overwrite-dns/);
    const forced = await run(["setup", "kw.example.com", "--overwrite-dns"], { FAKE_CF_MODE: "exists" });
    assert.equal(forced.code, 0, forced.all);
    assert.ok(forced.calls.includes("tunnel route dns --overwrite-dns kraftwerk-agent-playground kw.example.com"), forced.calls.join("\n"));
  });

  it("run refuses while the tunnel is off, and reports a cloudflared that keeps dying", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\nport: 1985\n");
    const off = await run([]);
    assert.equal(off.code, 1);
    assert.match(off.stderr, /tunnel is off — `kraftwerk tunnel setup <hostname>`/);
    assert.deepEqual(off.calls, []);

    // A port nothing listens on (1985 may be a real inspector on this machine).
    const free = await new Promise<number>((resolve) => {
      const srv = createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = (srv.address() as AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });
    await fx.write("kraftwerk.yml", `name: fixture\nport: ${free}\npublic: kw.example.com\ntunnel:\n  name: kw\n`);
    const r = await run([]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`⚠ nothing answers on http://127\\.0\\.0\\.1:${free} yet`));
    assert.match(r.stdout, new RegExp(`↗ tunnel: running kw → https://kw\\.example\\.com → http://127\\.0\\.0\\.1:${free}`));
    assert.match(r.stdout, /cloudflared │ fake run failed/);
    assert.match(r.stderr, /exited 3 times right after launch — giving up/);
    assert.deepEqual(r.calls, Array(3).fill(`tunnel --no-autoupdate run --url http://127.0.0.1:${free} kw`));
  });
});
