import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

const CONCEPT = `---
type: Playbook
title: Escalation
description: When to hand a ticket to engineering.
tags: [support, escalation]
---

# Rule

Anything reproducible on production goes to engineering the same day.
`;

/** The enforced write path: put stamps provenance, logs, reindexes; verify raises trust. */
describe("kraftwerk knowledge", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  let kroot: string;
  const run = (args: string[], stdin?: string) => cli(dir.root, dir.home, ["knowledge", ...args], { stdin });

  before(async () => {
    dir = await makeEmptyDir();
    await cli(dir.root, dir.home, ["init"]);
    kroot = path.join(dir.root, "kraftwerk-data", "knowledge");
  });
  after(() => dir.cleanup());

  it("lists the demo bundle init created", async () => {
    const r = await run(["list", "--json"]);
    assert.equal(r.code, 0, r.all);
    const { bundles } = json<{ bundles: { name: string; concepts: number }[] }>(r);
    assert.deepEqual(bundles.map((b) => [b.name, b.concepts]), [["demo-customer-support", 1]]);
  });

  it("init creates an empty bundle and refuses to create it twice", async () => {
    const r = await run(["init", "support"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(existsSync(path.join(kroot, "support", "index.md")));
    assert.ok(existsSync(path.join(kroot, "support", "log.md")));
    const again = await run(["init", "support"]);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /support/);
  });

  it("put from stdin stamps the actor, logs, and reindexes", async () => {
    const r = await run(["put", "support/playbooks/escalation", "--actor", "triage-bot/1.0"], CONCEPT);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ created support\/playbooks\/escalation \(Playbook, by triage-bot\/1\.0\)/);

    const file = await readFile(path.join(kroot, "support", "playbooks", "escalation.md"), "utf8");
    assert.match(file, /^generated:/m);
    assert.match(file, /by: triage-bot\/1\.0/);
    assert.match(await readFile(path.join(kroot, "support", "log.md"), "utf8"), /escalation/);
    assert.match(await readFile(path.join(kroot, "support", "index.md"), "utf8"), /escalation/i);

    const again = await run(["put", "support/playbooks/escalation"], CONCEPT.replace("same day", "same hour"));
    assert.match(again.stdout, /✔ updated support\/playbooks\/escalation/);
  });

  it("put refuses empty input and a ref without a bundle", async () => {
    const empty = await run(["put", "support/nothing"], "   \n");
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /No content/);
    const bad = await run(["put", "nobundle"], CONCEPT);
    assert.notEqual(bad.code, 0);
  });

  it("get prints the raw markdown, --json the parsed concept", async () => {
    const raw = await run(["get", "support/playbooks/escalation"]);
    assert.equal(raw.code, 0, raw.all);
    assert.match(raw.stdout, /same hour/);
    const parsed = json<{ id: string; type: string; trustTier: string }>(await run(["get", "support/playbooks/escalation", "--json"]));
    assert.equal(parsed.id, "playbooks/escalation");
    assert.equal(parsed.type, "Playbook");
    assert.equal(parsed.trustTier, "unverified");

    const missing = await run(["get", "support/playbooks/nope"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /not found/);
  });

  it("search finds the concept across bundles and within one", async () => {
    const all = json<{ hits: { bundle: string; id: string }[] }>(await run(["search", "engineering", "--json"]));
    assert.deepEqual(all.hits.map((h) => `${h.bundle}/${h.id}`), ["support/playbooks/escalation"]);
    const scoped = json<{ hits: unknown[] }>(await run(["search", "refund", "--bundle", "support", "--json"]));
    assert.equal(scoped.hits.length, 0);
    const demo = json<{ hits: unknown[] }>(await run(["search", "refund", "--bundle", "demo-customer-support", "--json"]));
    assert.equal(demo.hits.length, 1);
  });

  it("verify by a human raises the trust tier to human-reviewed", async () => {
    const r = await run(["verify", "support/playbooks/escalation", "--by", "human:lukas"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /verified by human:lukas → human-reviewed/);
    const parsed = json<{ trustTier: string }>(await run(["get", "support/playbooks/escalation", "--json"]));
    assert.equal(parsed.trustTier, "human-reviewed");
  });

  it("validate passes, and fsck --fix heals a deleted index", async () => {
    const ok = await run(["validate"]);
    assert.equal(ok.code, 0, ok.all);
    assert.match(ok.stdout, /✔ 2 bundle\(s\) conformant/);

    const index = path.join(kroot, "support", "index.md");
    await rm(index);
    const fixed = await run(["fsck", "--fix"]);
    assert.equal(fixed.code, 0, fixed.all);
    assert.ok(existsSync(index), "index.md regenerated");
    assert.match(await readFile(index, "utf8"), /escalation/i);
  });
});
