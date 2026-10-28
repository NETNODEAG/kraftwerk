import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ContactDef, EntitiesView, EntityDetail, EventDef, PlaceDef } from "../../src/core/entities.js";
import { entitiesContext } from "../../src/core/entities.js";
import { projectContext, type ProjectDetail } from "../../src/core/projects.js";
import type { ResolvedRef } from "../../src/core/refs.js";
import type { AgentSearch } from "../../src/core/search.js";
import type { TrashEntry } from "../../src/core/trash.js";
import type { GitStatus } from "../../src/core/git.js";

/**
 * Contacts, places and events over the HTTP API: the three feature flags,
 * creating entries from fields, the Markdown+frontmatter files they
 * become, the derived Google Maps link, cross-entity references and their
 * states, the date filter on events, projects linking to them, the
 * reference resolver (tokens in text), the ⌘K data, the agent context,
 * the workspace git's scope, and removal into the trash.
 */
describe("contacts, places and events API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) => fetch(srv.url + p, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const put = (p: string, body: unknown) => fetch(srv.url + p, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  const del = (p: string) => fetch(srv.url + p, { method: "DELETE", headers: headers() });
  const get = async <T>(p: string): Promise<T> => (await fetch(srv.url + p)).json() as Promise<T>;
  const meta = () => get<{ contacts: boolean; places: boolean; events: boolean; projects: boolean }>("/api/meta");
  const file = (kind: string, slug: string) => path.join(fx.root, "kraftwerk-data", kind, `${slug}.md`);

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("is off without the blocks: listing says so, creating is refused", async () => {
    const m = await meta();
    assert.deepEqual([m.contacts, m.places, m.events], [false, false, false]);
    for (const kind of ["contacts", "places", "events"]) {
      const v = await get<EntitiesView<ContactDef>>(`/api/${kind}`);
      assert.equal(v.enabled, false, kind);
      assert.match(v.error ?? "", /are off/);
      assert.equal((await post(`/api/${kind}`, { title: "x", start: "2026-01-01" })).status, 409, kind);
    }
  });

  it("settings turn each one on and create its root — part of the workspace, not git-ignored", async () => {
    const r = await put("/api/settings", { contacts: { enabled: true }, places: { enabled: true, root: "kraftwerk-data/places" }, events: { enabled: true } });
    assert.equal(r.status, 200, await r.text());
    const m = await meta();
    assert.deepEqual([m.contacts, m.places, m.events], [true, true, true]);
    const yml = await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8");
    for (const kind of ["contacts", "places", "events"]) {
      assert.match(yml, new RegExp(`^${kind}: \\{\\}$`, "m"), kind);
      assert.ok(existsSync(path.join(fx.root, "kraftwerk-data", kind)), kind);
      assert.deepEqual((await get<EntitiesView<ContactDef>>(`/api/${kind}`)).items, []);
    }
    assert.ok(!existsSync(path.join(fx.root, ".gitignore")), "nothing ignored");
  });

  it("POST /api/places writes a Markdown file with frontmatter; the maps link derives from lat/lng and is never written", async () => {
    const r = await post("/api/places", { title: "NETNODE Office", address: "Zentralstrasse 1, 6003 Luzern", lat: "47.05", lng: 8.3, notes: "Third floor, ring twice." });
    const p = (await r.json()) as EntityDetail<PlaceDef>;
    assert.equal(r.status, 201, JSON.stringify(p));
    assert.equal(p.slug, "netnode-office");
    assert.equal(p.lat, 47.05, "numbers arrive as numbers, even from a string");
    assert.equal(p.mapsUrl, "https://www.google.com/maps?q=47.05,8.3");
    assert.equal(p.notes, "Third floor, ring twice.\n");
    assert.equal(p.path, file("places", "netnode-office"));
    const raw = await readFile(p.path, "utf8");
    assert.match(raw, /^---\ntitle: NETNODE Office\naddress: Zentralstrasse 1, 6003 Luzern\nlat: 47.05\nlng: 8.3\n---\n\nThird floor, ring twice\.\n$/);

    assert.equal((await post("/api/places", { title: "Half", lat: 47 })).status, 400, "lat without lng");
    assert.equal((await post("/api/places", { title: "Far", lat: 91, lng: 0 })).status, 400, "out of range");
    assert.equal((await post("/api/places", { title: "NETNODE Office" })).status, 400, "duplicate");
    assert.equal((await post("/api/places", { title: "x", slug: "../up" })).status, 400, "unsafe slug");
    assert.equal((await post("/api/places", { title: "   " })).status, 400, "empty title");

    // An address alone gives a search link; a google-maps record wins over both.
    const byAddress = (await (await post("/api/places", { title: "Bahnhof", address: "Bahnhofplatz, Luzern" })).json()) as EntityDetail<PlaceDef>;
    assert.equal(byAddress.mapsUrl, "https://www.google.com/maps/search/?api=1&query=Bahnhofplatz%2C%20Luzern");
    const withRecord = (await (await put("/api/places/bahnhof", { records: [{ kind: "google-maps", url: "https://maps.app.goo.gl/abc" }] })).json()) as EntityDetail<PlaceDef>;
    assert.equal(withRecord.mapsUrl, "https://maps.app.goo.gl/abc");
    assert.doesNotMatch(await readFile(withRecord.path, "utf8"), /mapsUrl/);
  });

  it("POST /api/contacts: fields are checked, the place is a reference whose state is reported", async () => {
    const r = await post("/api/contacts", {
      title: "Anna Meier",
      org: "ACME",
      email: "anna@acme.ch",
      place: "place:netnode-office",
      tags: ["client"],
      records: [{ kind: "crm", url: "https://crm.example/anna", note: "deal history" }, { kind: "newsletter", title: "Monthly" }],
      notes: "Met at place:netnode-office.",
    });
    const c = (await r.json()) as EntityDetail<ContactDef>;
    assert.equal(r.status, 201, JSON.stringify(c));
    assert.equal(c.slug, "anna-meier");
    assert.equal(c.place, "netnode-office", "a token prefix on a ref field is dropped");
    assert.deepEqual(c.links, { place: [{ slug: "netnode-office", found: true, label: "NETNODE Office — Zentralstrasse 1, 6003 Luzern" }] });
    assert.deepEqual(c.tags, ["client"]);
    assert.equal(c.records[0].kind, "crm");
    const raw = await readFile(c.path, "utf8");
    assert.match(raw, /^org: ACME$/m);
    assert.match(raw, /^place: netnode-office$/m);
    assert.match(raw, /^tags:\n  - client$/m);
    assert.match(raw, /^records:\n  - kind: crm/m);

    assert.equal((await post("/api/contacts", { title: "Bad", email: "not-an-email" })).status, 400);
    assert.equal((await post("/api/contacts", { title: "Bad", url: "ftp://x" })).status, 400);
    assert.equal((await post("/api/contacts", { title: "Bad", place: "Not A Slug" })).status, 400);
    assert.equal((await post("/api/contacts", { title: "Bad", records: [{ url: "https://x.y" }] })).status, 400, "record kind required");
  });

  it("POST /api/events: start is required, the slug carries the date, contacts and project are references, ?from/?to narrow the list", async () => {
    let r = await post("/api/events", { title: "Kickoff", start: "2026-11-03T14:00", end: "2026-11-03T16:00", place: "netnode-office", contacts: ["anna-meier", "nobody"], project: "relaunch" });
    const e = (await r.json()) as EntityDetail<EventDef>;
    assert.equal(r.status, 201, JSON.stringify(e));
    assert.equal(e.slug, "2026-11-03-kickoff");
    assert.deepEqual(e.links.contacts, [{ slug: "anna-meier", found: true, label: "Anna Meier (ACME)" }, { slug: "nobody", found: false }]);
    assert.deepEqual(e.links.project, [{ slug: "relaunch", found: false }], "projects are off: the target is reported missing, not an error");
    assert.match(await readFile(e.path, "utf8"), /^start: 2026-11-03T14:00\nend: 2026-11-03T16:00\nplace: netnode-office\ncontacts:\n  - anna-meier\n  - nobody\nproject: relaunch$/m);

    assert.equal((await post("/api/events", { title: "No date" })).status, 400, "start required");
    assert.equal((await post("/api/events", { title: "Bad", start: "3 Nov" })).status, 400, "ISO only");
    assert.equal((await post("/api/events", { title: "Bad", start: "2026-11-03", end: "2026-11-02" })).status, 400, "end before start");
    assert.equal((await post("/api/events", { title: "Bad", start: "2026-11-03T23:30+02:00", end: "2026-11-03T20:00Z" })).status, 400, "compared as instants, not text");
    r = await post("/api/events", { title: "Launch", start: "2099-01-01" });
    assert.equal(r.status, 201);
    // A plain day as the end means until the end of that day; two days as a span.
    r = await post("/api/events", { title: "Same day", start: "2026-11-03T14:00", end: "2026-11-03" });
    assert.equal(r.status, 201, await r.text());
    r = await post("/api/events", { title: "Offsite", start: "2026-11-02", end: "2026-11-05" });
    assert.equal(r.status, 201, await r.text());

    const all = await get<EntitiesView<EventDef>>("/api/events");
    assert.deepEqual(all.items.map((x) => x.slug), ["2026-11-02-offsite", "2026-11-03-kickoff", "2026-11-03-same-day", "2099-01-01-launch"], "by start");
    assert.deepEqual((await get<EntitiesView<EventDef>>("/api/events?from=2026-11-04")).items.map((x) => x.slug), ["2026-11-02-offsite", "2099-01-01-launch"], "the offsite is still running");
    assert.deepEqual((await get<EntitiesView<EventDef>>("/api/events?to=2026-11-02")).items.map((x) => x.slug), ["2026-11-02-offsite"]);
    assert.deepEqual((await get<EntitiesView<EventDef>>("/api/events?from=2027-01-01&to=2098-12-31")).items, []);
    assert.equal((await del("/api/events/2026-11-03-same-day")).status, 200);
    assert.equal((await del("/api/events/2026-11-02-offsite")).status, 200);
  });

  it("PUT merges fields, '' clears one, notes replace the body, and unknown frontmatter keys survive", async () => {
    await fx.write("kraftwerk-data/contacts/anna-meier.md", (await readFile(file("contacts", "anna-meier"), "utf8")).replace("org: ACME\n", "org: ACME\nbirthday: 1990-05-04\n"));
    let r = await put("/api/contacts/anna-meier", { role: "CTO", email: "", notes: "# Anna\n\nPrefers email.\n" });
    const c = (await r.json()) as EntityDetail<ContactDef>;
    assert.equal(r.status, 200, JSON.stringify(c));
    assert.equal(c.role, "CTO");
    assert.equal(c.email, undefined);
    assert.equal(c.notes, "# Anna\n\nPrefers email.\n");
    assert.deepEqual(c.extra, { birthday: "1990-05-04" });
    const raw = await readFile(c.path, "utf8");
    assert.match(raw, /^role: CTO$/m);
    assert.doesNotMatch(raw, /^email:/m);
    assert.match(raw, /^birthday: 1990-05-04$/m, "kept verbatim");
    assert.match(raw, /---\n\n# Anna\n\nPrefers email\.\n$/);

    assert.equal((await put("/api/contacts/anna-meier", { title: "" })).status, 400);
    assert.equal((await put("/api/contacts/nope", { role: "x" })).status, 404);
    assert.equal((await put("/api/events/2026-11-03-kickoff", { end: "2026-11-01" })).status, 400);
  });

  it("files without frontmatter and files with broken frontmatter are listed, not hidden", async () => {
    await fx.write("kraftwerk-data/contacts/plain.md", "Just a note about someone.\n");
    await fx.write("kraftwerk-data/events/broken.md", "---\ntitle: Broken\nstart: whenever\n---\n");
    const plain = await get<EntityDetail<ContactDef>>("/api/contacts/plain");
    assert.equal(plain.title, "plain");
    assert.equal(plain.notes, "Just a note about someone.\n");
    const broken = (await get<EntitiesView<EventDef>>("/api/events")).items.find((x) => x.slug === "broken");
    assert.match(broken?.configError ?? "", /start must be an ISO date/);
    assert.deepEqual((await get<EntitiesView<EventDef>>("/api/events?from=2000-01-01")).items.map((x) => x.slug).includes("broken"), false, "a broken file has no date to filter by");
    // Saving would rewrite the file from defaults: refused, the file stays as written.
    const r = await put("/api/events/broken", { title: "Fixed" });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /fixed by hand/);
    assert.equal(await readFile(file("events", "broken"), "utf8"), "---\ntitle: Broken\nstart: whenever\n---\n");
    // A file whose name is not a slug is listed with the reason, not hidden.
    await fx.write("kraftwerk-data/contacts/Max Muster.md", "---\ntitle: Max\n---\n");
    const odd = (await get<EntitiesView<ContactDef>>("/api/contacts")).items.find((x) => x.slug === "Max Muster");
    assert.match(odd?.configError ?? "", /file name must be a slug/);
    assert.ok(!(await get<AgentSearch>("/api/search/agents")).workspaces[0].entities.some((h) => h.slug === "Max Muster"), "not offered in the palette");
    // An empty frontmatter block is frontmatter, not notes.
    await fx.write("kraftwerk-data/contacts/empty.md", "---\n---\nSome notes\n");
    const empty = await get<EntityDetail<ContactDef>>("/api/contacts/empty");
    assert.equal(empty.notes, "Some notes\n");
    assert.equal((await put("/api/contacts/empty", { role: "CTO" })).status, 200);
    assert.equal(await readFile(file("contacts", "empty"), "utf8"), "---\ntitle: empty\nrole: CTO\n---\n\nSome notes\n");
    assert.equal((await del("/api/contacts/plain")).status, 200);
    assert.equal((await del("/api/contacts/empty")).status, 200);
    assert.equal((await del("/api/events/broken")).status, 200);
    await rm(path.join(fx.root, "kraftwerk-data/contacts/Max Muster.md"));
  });

  it("PUT with a GET body back writes only the fields: path, updatedAt, links and the maps link never land in the file", async () => {
    const detail = await get<EntityDetail<PlaceDef>>("/api/places/netnode-office");
    assert.ok(detail.mapsUrl && detail.path && detail.updatedAt && detail.links);
    const r = await put("/api/places/netnode-office", { ...detail, address: "Zentralstrasse 1, 6003 Luzern" });
    assert.equal(r.status, 200, await r.text());
    const raw = await readFile(detail.path, "utf8");
    for (const key of ["path", "updatedAt", "links", "mapsUrl", "configError", "slug"]) assert.doesNotMatch(raw, new RegExp(`^${key}:`, "m"), key);
    assert.equal((await get<EntityDetail<PlaceDef>>("/api/places/netnode-office")).extra, undefined);
  });

  it("projects link to contacts, places and events like to anything else; the project's context lists them", async () => {
    assert.equal((await put("/api/settings", { projects: { enabled: true } })).status, 200);
    const created = await post("/api/projects", { title: "Relaunch", slug: "relaunch", goal: "ship it" });
    assert.equal(created.status, 201, await created.text());
    let r = await post("/api/projects/relaunch/links", { kind: "contacts", target: "anna-meier" });
    let p = (await r.json()) as ProjectDetail;
    assert.equal(r.status, 200, JSON.stringify(p));
    assert.deepEqual(p.links.contacts, [{ slug: "anna-meier", found: true, label: "Anna Meier (CTO, ACME)" }]);
    r = await put("/api/projects/relaunch", { places: ["netnode-office"], events: ["2026-11-03-kickoff", "someday"] });
    p = (await r.json()) as ProjectDetail;
    assert.deepEqual(p.links.places, [{ slug: "netnode-office", found: true, label: "NETNODE Office — Zentralstrasse 1, 6003 Luzern" }]);
    assert.deepEqual(p.links.events, [{ slug: "2026-11-03-kickoff", found: true, label: "2026-11-03 14:00–2026-11-03 16:00 Kickoff" }, { slug: "someday", found: false }]);
    const yml = await readFile(path.join(fx.root, "kraftwerk-data/projects/relaunch/project.yml"), "utf8");
    assert.match(yml, /^contacts:\n  - anna-meier$/m);
    assert.match(yml, /^events:\n  - 2026-11-03-kickoff\n  - someday$/m);

    // Now that the project exists, the event's project reference resolves.
    const e = await get<EntityDetail<EventDef>>("/api/events/2026-11-03-kickoff");
    assert.deepEqual(e.links.project, [{ slug: "relaunch", found: true, label: "Relaunch" }]);

    const ctx = await projectContext("relaunch", "kraftwerk-chat/claude");
    assert.match(ctx, /## Contacts\n[^\n]*\n- contact:anna-meier — Anna Meier \(CTO, ACME\)/);
    assert.match(ctx, /## Places\n[^\n]*\n- place:netnode-office — NETNODE Office — Zentralstrasse 1, 6003 Luzern \(https:\/\/www\.google\.com\/maps\?q=47\.05,8\.3\)/);
    assert.match(ctx, /## Events\n[^\n]*\n- event:2026-11-03-kickoff — 2026-11-03 14:00–2026-11-03 16:00 Kickoff\n- event:someday \(configured but not found/);
    assert.match(ctx, /projects link relaunch <kind> <name>/);
  });

  it("POST /api/refs/resolve resolves tokens and the references found in a text; URLs and unknown kinds never match", async () => {
    const r = await post("/api/refs/resolve", {
      tokens: ["contact:anna-meier", "place:nope", "projects:relaunch"],
      text: "Meet at place:netnode-office for event:2026-11-03-kickoff — see https://example.com/contact:fake and mailto:contact:x, ticket:123, agent:none.",
    });
    const { refs } = (await r.json()) as { refs: ResolvedRef[] };
    assert.equal(r.status, 200, JSON.stringify(refs));
    assert.deepEqual(
      refs.map((x) => [x.token, x.found, x.href]),
      [
        ["contact:anna-meier", true, "/contacts/anna-meier"],
        ["place:nope", false, "/places/nope"],
        ["project:relaunch", true, "/projects/relaunch"],
        ["place:netnode-office", true, "/places/netnode-office"],
        ["event:2026-11-03-kickoff", true, "/events/2026-11-03-kickoff"],
        ["agent:none", false, "/agents/none"],
      ],
    );
    assert.equal(refs[0].label, "Anna Meier (CTO, ACME)");
    assert.equal((await post("/api/refs/resolve", { tokens: ["https://x.y"] })).status, 400);
    assert.equal((await post("/api/refs/resolve", { tokens: ["ticket:123"] })).status, 400);
  });

  it("the ⌘K palette lists this workspace's contacts, places and events", async () => {
    const s = await get<AgentSearch>("/api/search/agents");
    const hits = s.workspaces[0].entities.map((e) => [e.kind, e.slug, e.title, e.detail]);
    assert.deepEqual(hits, [
      ["contacts", "anna-meier", "Anna Meier", "CTO, ACME"],
      ["places", "bahnhof", "Bahnhof", "Bahnhofplatz, Luzern"],
      ["places", "netnode-office", "NETNODE Office", "Zentralstrasse 1, 6003 Luzern"],
      ["events", "2026-11-03-kickoff", "Kickoff", "2026-11-03 14:00–2026-11-03 16:00"],
      ["events", "2099-01-01-launch", "Launch", "2099-01-01"],
    ]);
  });

  it("every chat's context explains the kinds, the token syntax, the CLI and the next events", async () => {
    const ctx = await entitiesContext();
    assert.match(ctx, /^## Contacts, places and events\n/);
    assert.match(ctx, /- contacts \(1\):/);
    assert.match(ctx, /- places \(2\):/);
    assert.match(ctx, /- events \(2\):/);
    assert.match(ctx, /`contact:<slug>`, `place:<slug>`, `event:<slug>`/);
    assert.match(ctx, /npx kraftwerk contacts\|places\|events list --json/);
    assert.match(ctx, /npx kraftwerk ref <kind:slug>/);
    assert.match(ctx, /Next events:\n- event:2026-11-03-kickoff — [^\n]*\n- event:2099-01-01-launch — 2099-01-01 Launch$/);
  });

  it("the files are in the workspace git's scope: syncable", async () => {
    const st = await get<GitStatus>("/api/git?fresh=1");
    for (const rel of ["kraftwerk-data/contacts/anna-meier.md", "kraftwerk-data/places/netnode-office.md", "kraftwerk-data/events/2026-11-03-kickoff.md"]) {
      const f = st.files?.find((x) => x.path === rel);
      assert.ok(f, `${rel} in ${JSON.stringify(st.files?.map((x) => x.path))}`);
      assert.equal(f?.syncable, true, f?.reason ?? "not syncable");
    }
  });

  it("DELETE moves the file to the trash; a second DELETE and GET are 404; settings turn the features off", async () => {
    assert.equal((await del("/api/contacts/anna-meier")).status, 200);
    assert.ok(!existsSync(file("contacts", "anna-meier")));
    const entry = ((await get<{ entries: TrashEntry[] }>("/api/trash")).entries).find((t) => t.kind === "contacts");
    assert.deepEqual([entry?.name, entry?.from, entry?.file], ["anna-meier", "kraftwerk-data/contacts/anna-meier.md", "anna-meier.md"]);
    assert.equal((await del("/api/contacts/anna-meier")).status, 404);
    assert.equal((await get<{ error?: string }>("/api/contacts/anna-meier")).error, 'no contact "anna-meier"');
    // The references that pointed at it now report it missing.
    const e = await get<EntityDetail<EventDef>>("/api/events/2026-11-03-kickoff");
    assert.deepEqual(e.links.contacts[0], { slug: "anna-meier", found: false });

    assert.equal((await put("/api/settings", { contacts: { enabled: false }, places: { enabled: false }, events: { enabled: false } })).status, 200);
    const m = await meta();
    assert.deepEqual([m.contacts, m.places, m.events], [false, false, false]);
    assert.doesNotMatch(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /contacts|places|events/);
    assert.equal((await fetch(srv.url + "/api/events/2026-11-03-kickoff")).status, 409);
  });
});
