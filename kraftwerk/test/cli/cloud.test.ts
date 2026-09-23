import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/** kraftwerk.yml `cloud`: on by default, what doctor accepts and refuses, how it is turned off. */
describe("kraftwerk.yml cloud", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  const doctor = async (config: string, env: Record<string, string> = {}) => {
    await fx.write("kraftwerk.yml", `name: fixture\n${config}`);
    // The helper pins KRAFTWERK_CLOUD_URL=off; doctor never registers, so the default URL is safe to show here.
    return cli(fx.root, fx.home, ["doctor"], { env: { KRAFTWERK_CLOUD_URL: "", ...env } });
  };

  it("refuses malformed values, and a token in the file", async () => {
    const cases: Array<[string, RegExp]> = [
      ["cloud: 42\n", /cloud must be a mapping/],
      ["cloud:\n  host: x\n", /cloud\.host is unknown/],
      ["cloud:\n  token: kwc_abc\n", /cloud\.token does not belong in kraftwerk\.yml — put KRAFTWERK_CLOUD_TOKEN into \.env/],
      ["cloud:\n  url: kraftwerk.start\n", /cloud\.url must be an http\(s\) origin/],
      ["cloud:\n  url: https://kraftwerk.start/?x=1\n", /cloud\.url must be an http\(s\) origin/],
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

  it("is on by default with the netnode cloud, and says how to opt out", async () => {
    const none = await doctor("", { KRAFTWERK_CLOUD_TOKEN: "" });
    assert.match(none.stdout, /✔ cloud: https:\/\/srv\.kraftwerk-cloud\.netnode\.cloud — on by default — the UI shows a claim code under Settings → Cloud; opt out with cloud\.enabled: false/);

    const custom = await doctor("cloud:\n  url: https://cloud.example.com\n  interval: 30\n", { KRAFTWERK_CLOUD_TOKEN: "kwc_env" });
    assert.match(custom.stdout, /cloud: https:\/\/cloud\.example\.com — registers under your kraftwerk account \(KRAFTWERK_CLOUD_TOKEN\), heartbeat every 30s/);
  });

  it("the environment wins over the file: a URL, or off", async () => {
    const env = await doctor("cloud:\n  url: https://cloud.example.com\n", { KRAFTWERK_CLOUD_URL: "https://other.example.com", KRAFTWERK_CLOUD_TOKEN: "" });
    assert.match(env.stdout, /cloud: https:\/\/other\.example\.com/);

    const off = await doctor("", { KRAFTWERK_CLOUD_URL: "off" });
    assert.match(off.stdout, /• cloud: off — KRAFTWERK_CLOUD_URL=off/);
    const disabled = await doctor("cloud:\n  enabled: false\n");
    assert.match(disabled.stdout, /• cloud: off — cloud\.enabled: false in kraftwerk\.yml/);
  });
});
