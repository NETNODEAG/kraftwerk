import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { ContactDef, EntitiesView, EntityDetail, EventDef, PlaceDef } from "../../src/core/entities.js";
import type { ResolvedRef } from "../../src/core/refs.js";

/** `kraftwerk contacts|places|events` and `kraftwerk ref`: flags, create, list, show, set, remove, doctor on the config keys, references. */
describe("kraftwerk contacts, places, events, ref", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  const file = (kind: string, slug: string) => path.join(fx.root, "kraftwerk-data", kind, `${slug}.md`);

  it("refuses everything while the features are off", async () => {
    for (const kind of ["contacts", "places", "events"]) {
      const r = await cli(fx.root, fx.home, [kind]);
      assert.equal(r.code, 1, kind);
      assert.match(r.stderr, new RegExp(`${kind} are off`));
      assert.equal((await cli(fx.root, fx.home, [kind, "create", "Demo", "--start", "2026-01-01"])).code, 1, kind);
    }
  });

  it("doctor rejects a root outside the project and unknown keys", async () => {
    for (const root of ["..", "/tmp", "."]) {
      await fx.write("kraftwerk.yml", `name: fixture\nplaces:\n  root: ${JSON.stringify(root)}\n`);
      const r = await cli(fx.root, fx.home, ["doctor"]);
      assert.equal(r.code, 1, root);
      assert.match(r.stdout, /kraftwerk\.yml: places\.root must be a directory inside the project/, root);
    }
    await fx.write("kraftwerk.yml", "name: fixture\nevents:\n  colour: red\n");
    assert.match((await cli(fx.root, fx.home, ["doctor"])).stdout, /events\.colour is unknown/);
  });

  it("create writes the file from the fields; list and show read it back", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\ncontacts:\nplaces:\nevents:\n"); // bare keys: on, default roots
    let r = await cli(fx.root, fx.home, ["contacts", "create", "Anna Meier", "--org", "ACME", "--email", "anna@acme.ch", "--tags", "client, lead", "--notes", "Met in Lucerne.", "--json"]);
    assert.equal(r.code, 0, r.all);
    const c = json<EntityDetail<ContactDef>>(r);
    assert.equal(c.slug, "anna-meier");
    assert.deepEqual(c.tags, ["client", "lead"]);
    assert.equal(c.notes, "Met in Lucerne.\n");
    const raw = await readFile(file("contacts", "anna-meier"), "utf8");
    assert.match(raw, /^---\ntitle: Anna Meier\norg: ACME\nemail: anna@acme\.ch\ntags:\n  - client\n  - lead\n---\n\nMet in Lucerne\.\n$/);
    assert.equal((await cli(fx.root, fx.home, ["contacts", "create", "Anna Meier"])).code, 1, "duplicate");
    r = await cli(fx.root, fx.home, ["contacts", "create", "Bad", "--email", "nope"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /email must be an email address/);

    r = await cli(fx.root, fx.home, ["places", "create", "Office", "--address", "Zentralstrasse 1, Luzern", "--lat", "47.05", "--lng", "8.3"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ place:office → .*kraftwerk-data\/places\/office\.md/);
    const show = await cli(fx.root, fx.home, ["places", "show", "office"]);
    assert.equal(show.code, 0, show.all);
    assert.match(show.stdout, /^Office \(place:office\)/m);
    assert.match(show.stdout, /map\s+https:\/\/www\.google\.com\/maps\?q=47\.05,8\.3/);
    assert.equal(json<EntityDetail<PlaceDef>>(await cli(fx.root, fx.home, ["places", "show", "office", "--json"])).mapsUrl, "https://www.google.com/maps?q=47.05,8.3");

    const table = await cli(fx.root, fx.home, ["contacts"]);
    assert.equal(table.code, 0, table.all);
    assert.match(table.stdout, /Anna Meier/);
    assert.match(table.stdout, /│ ACME\s+│/, "the details column carries what the title does not");
    const sub = await cli(path.join(fx.root, "kraftwerk-data"), fx.home, ["contacts", "--json"]);
    assert.deepEqual(json<EntitiesView<ContactDef>>(sub).items.map((x) => x.slug), ["anna-meier"], "from a subdirectory too");
  });

  it("set changes fields and references; show marks a reference found or missing", async () => {
    let r = await cli(fx.root, fx.home, ["contacts", "set", "anna-meier", "--place", "office", "--role", "CTO", "--email", ""]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ contact:anna-meier — Anna Meier \(CTO, ACME\)/);
    const raw = await readFile(file("contacts", "anna-meier"), "utf8");
    assert.match(raw, /^place: office$/m);
    assert.doesNotMatch(raw, /^email:/m);
    const show = await cli(fx.root, fx.home, ["contacts", "show", "anna-meier"]);
    assert.match(show.stdout, /place\s+✔ office\s+Office — Zentralstrasse 1, Luzern/);
    assert.match(show.stdout, /notes\nMet in Lucerne\./);
    assert.equal((await cli(fx.root, fx.home, ["contacts", "set", "anna-meier"])).code, 1, "nothing to set");
    r = await cli(fx.root, fx.home, ["contacts", "set", "anna-meier", "--place", "No Such"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /place must be a places slug/);
    assert.equal((await cli(fx.root, fx.home, ["contacts", "set", "nope", "--role", "x"])).code, 1, "unknown contact");
  });

  it("events need a start; the slug carries the date; missing references are reported, not refused; --from/--to narrow the list", async () => {
    let r = await cli(fx.root, fx.home, ["events", "create", "Kickoff"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /start is required/);
    r = await cli(fx.root, fx.home, ["events", "create", "Kickoff", "--start", "2026-11-03T14:00", "--place", "office", "--contacts", "anna-meier,ghost", "--project", "relaunch"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ event:2026-11-03-kickoff → .* \(not found in this workspace yet: ghost, relaunch\)/);
    assert.match(await readFile(file("events", "2026-11-03-kickoff"), "utf8"), /^contacts:\n  - anna-meier\n  - ghost$/m);
    assert.equal((await cli(fx.root, fx.home, ["events", "create", "Later", "--start", "2099-01-01", "--end", "2098-12-31"])).code, 1, "end before start");
    assert.equal((await cli(fx.root, fx.home, ["events", "create", "Later", "--start", "2099-01-01"])).code, 0);

    const show = await cli(fx.root, fx.home, ["events", "show", "2026-11-03-kickoff"]);
    assert.match(show.stdout, /contacts\s+✔ anna-meier\s+Anna Meier \(CTO, ACME\), \? ghost \(not found\)/);
    assert.deepEqual(json<EntitiesView<EventDef>>(await cli(fx.root, fx.home, ["events", "--from", "2026-11-04", "--json"])).items.map((x) => x.slug), ["2099-01-01-later"]);
    assert.deepEqual(json<EntitiesView<EventDef>>(await cli(fx.root, fx.home, ["events", "list", "--to", "2026-11-03", "--json"])).items.map((x) => x.slug), ["2026-11-03-kickoff"]);
  });

  it("ref resolves one reference or every reference in a file, and exits 1 when a target is missing", async () => {
    let r = await cli(fx.root, fx.home, ["ref", "contact:anna-meier"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ contact:anna-meier\s+Anna Meier \(CTO, ACME\)/);
    r = await cli(fx.root, fx.home, ["ref", "contacts:anna-meier", "--json"]);
    assert.equal(json<{ refs: ResolvedRef[] }>(r).refs[0].href, "/contacts/anna-meier", "the plural works too");
    r = await cli(fx.root, fx.home, ["ref", "contact:ghost"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /\? contact:ghost\s+\(not found\)/);
    r = await cli(fx.root, fx.home, ["ref", "https://example.com"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a reference/);

    await fx.write("notes.md", "Kickoff at place:office with contact:anna-meier (event:2026-11-03-kickoff); see https://x.y/agent:none and ticket:42.\n");
    r = await cli(fx.root, fx.home, ["ref", "--file", "notes.md"]);
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(r.stdout.trim().split("\n"), ["✔ place:office  Office — Zentralstrasse 1, Luzern", "✔ contact:anna-meier  Anna Meier (CTO, ACME)", "✔ event:2026-11-03-kickoff  2026-11-03 14:00 Kickoff"]);
  });

  it("remove moves the file to the trash; unknown slugs exit 1", async () => {
    const r = await cli(fx.root, fx.home, ["contacts", "remove", "anna-meier"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(file("contacts", "anna-meier")));
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/contacts/anna-meier/anna-meier.md")));
    assert.equal((await cli(fx.root, fx.home, ["contacts", "remove", "anna-meier"])).code, 1);
    assert.deepEqual(json<EntitiesView<ContactDef>>(await cli(fx.root, fx.home, ["contacts", "--json"])).items, []);
    assert.equal((await cli(fx.root, fx.home, ["ref", "contact:anna-meier"])).code, 1, "gone from the registry");
  });
});
