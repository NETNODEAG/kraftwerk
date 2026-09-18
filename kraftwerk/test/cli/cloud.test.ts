import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/** kraftwerk.yml `cloud`: what doctor accepts and refuses. */
describe("kraftwerk.yml cloud", () => {
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
      ["cloud: 42\n", /cloud must be a mapping/],
      ["cloud:\n  host: x\n", /cloud\.host is unknown/],
      ["cloud:\n  url: kraftwerk.start\n", /cloud\.url must be an http\(s\) origin/],
      ["cloud:\n  url: https://kraftwerk.start/?x=1\n", /cloud\.url must be an http\(s\) origin/],
      ["cloud:\n  token: \"has space\"\n", /cloud\.token must be the account token/],
      ["cloud:\n  interval: 0\n", /cloud\.interval must be a positive integer/],
      ["cloud:\n  interval: soon\n", /cloud\.interval must be a positive integer/],
      ["cloud:\n  enabled: yes please\n", /cloud\.enabled must be true or false/],
    ];
    for (const [config, error] of cases) {
      const r = await doctor(config);
      assert.equal(r.code, 1, config);
      assert.match(r.stdout, error, config);
    }
  });

  it("a bare block is on with the default url; a token flips the wording; disabled says nothing", async () => {
    const bare = await doctor("cloud:\n", { KRAFTWERK_CLOUD_TOKEN: "" });
    assert.match(bare.stdout, /cloud: https:\/\/kraftwerk\.start — registers anonymously/);

    const withToken = await doctor("cloud:\n  url: https://cloud.example.com\n  token: kwc_abc\n  interval: 30\n", { KRAFTWERK_CLOUD_TOKEN: "" });
    assert.match(withToken.stdout, /cloud: https:\/\/cloud\.example\.com — registers under your kraftwerk account \(cloud\.token\), heartbeat every 30s/);

    const envToken = await doctor("cloud:\n", { KRAFTWERK_CLOUD_TOKEN: "kwc_env" });
    assert.match(envToken.stdout, /\(KRAFTWERK_CLOUD_TOKEN\)/);

    const off = await doctor("cloud:\n  enabled: false\n  url: https://cloud.example.com\n");
    assert.doesNotMatch(off.stdout, /— registers/);
    assert.doesNotMatch(off.stdout, /kraftwerk\.yml invalid/);
  });
});
