import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Artifacts: the rail's entry under Home lists everything made in the
 * workspace — here a project's deck and a contact — newest first, with a
 * tile per enabled kind to make a new one, chips to filter by kind and a
 * search; a row opens the thing where it lives. No agent is involved.
 */
test.describe("artifacts", () => {
  const PROJECT = "artifacts-probe";
  const on = { projects: { enabled: true }, presentations: { enabled: true }, contacts: { enabled: true } };
  const off = { projects: { enabled: false }, presentations: { enabled: false }, contacts: { enabled: false } };
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: on })).ok()).toBeTruthy();
    expect((await request.post("/api/projects", { data: { title: "Artifacts probe", slug: PROJECT } })).status()).toBe(201);
    expect((await request.post("/api/presentations", { data: { title: "Quarterly review", slug: "quarterly-review", project: PROJECT } })).ok()).toBeTruthy();
    // A second later, so the contact is the newest.
    await new Promise((r) => setTimeout(r, 1_100));
    expect((await request.post("/api/contacts", { data: { title: "Erika Muster" } })).ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/presentations/quarterly-review?project=${PROJECT}`);
    await request.delete("/api/contacts/erika-muster");
    await request.delete(`/api/projects/${PROJECT}`);
    await request.put("/api/settings", { data: off });
  });

  test("lists what was made, filters by kind, searches, opens a row", async ({ page }) => {
    await page.goto("/#/today");
    await page.locator(".rail a[href='#/']").click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator(".rail a[href='#/']")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

    // A tile per enabled kind, with a + to make a new one; the apps tile is missing while vibeables are off.
    const tiles = page.getByRole("region", { name: "kinds" });
    await expect(tiles.getByRole("link", { name: "new slides" })).toHaveAttribute("href", "#/presentations/new");
    await expect(tiles.getByRole("link", { name: "new contact" })).toBeVisible();
    await expect(tiles.getByRole("button", { name: "show only apps" })).toHaveCount(0);

    const rows = page.locator(".artifact-row");
    await expect(rows.filter({ hasText: "Quarterly review" })).toContainText("Artifacts probe");
    await expect(rows.first()).toContainText("Erika Muster");

    // The tiles filter: pressed shows one kind, pressed again everything.
    const contactsTile = tiles.getByRole("button", { name: "show only contacts" });
    await contactsTile.click();
    await expect(contactsTile).toHaveAttribute("aria-pressed", "true");
    await expect(rows.filter({ hasText: "Quarterly review" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "Erika Muster" })).toBeVisible();
    await contactsTile.click();
    await expect(rows.filter({ hasText: "Quarterly review" })).toHaveCount(1);

    await page.getByRole("button", { name: "search home" }).click();
    await page.getByRole("searchbox", { name: "search home" }).fill("quarterly");
    await expect(rows).toHaveCount(1);

    // A row selects: the deck shows on the right, its slides drawn; "open" leads to where it lives.
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview).toContainText("Pick something");
    await rows.first().click();
    await expect(page).toHaveURL(/#\/\?open=presentations/);
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(preview.getByRole("heading", { level: 2, name: "Quarterly review" })).toBeVisible();
    await expect(preview.locator("[data-slide]")).toHaveCount(2);
    await preview.getByRole("link", { name: "open" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}/presentations/quarterly-review$`));
  });

  test("a contact shows on the right, to edit in place; close goes back to the hint", async ({ page }) => {
    await page.goto("/#/");
    await page.locator(".artifact-row", { hasText: "Erika Muster" }).click();
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview.getByRole("heading", { level: 2, name: "Erika Muster" })).toBeVisible();
    await expect(preview.locator("input").first()).toBeVisible();
    await preview.getByRole("link", { name: "close the preview" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(preview).toContainText("Pick something");
  });

  test("places: a map of all of them; a place zooms in with its details", async ({ page, request }) => {
    expect((await request.put("/api/settings", { data: { places: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.post("/api/places", { data: { title: "Map probe office", lat: 47.05, lng: 8.3 } })).ok()).toBeTruthy();
    expect((await request.post("/api/places", { data: { title: "Map probe depot", lat: 46.95, lng: 7.45 } })).ok()).toBeTruthy();
    try {
      await page.goto("/#/");
      await page.getByRole("button", { name: "show only places" }).click();
      await expect(page).toHaveURL(/#\/\?kind=places$/);
      const preview = page.getByRole("complementary", { name: "Preview" });
      const map = preview.getByRole("region", { name: "map of the places" });
      await expect(map).toBeVisible();
      await expect(map.locator("path.leaflet-interactive")).toHaveCount(2);
      await page.locator(".artifact-row", { hasText: "Map probe office" }).click();
      await expect(page).toHaveURL(/kind=places&open=places%3Amap-probe-office/);
      await expect(preview.getByRole("heading", { level: 2, name: "Map probe office" })).toBeVisible();
      await expect(map.locator(".leaflet-tooltip")).toHaveText("Map probe office");
      // A dot on the map selects its place.
      await map.locator("path[data-place='map-probe-depot']").dispatchEvent("click");
      await expect(page).toHaveURL(/open=places%3Amap-probe-depot/);
    } finally {
      await request.delete("/api/places/map-probe-office");
      await request.delete("/api/places/map-probe-depot");
      await request.put("/api/settings", { data: { places: { enabled: false } } });
    }
  });

  test("events: a month calendar; an event shows its month and details", async ({ page, request }) => {
    expect((await request.put("/api/settings", { data: { events: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.post("/api/events", { data: { title: "Cal probe launch", start: "2026-03-10T14:00", end: "2026-03-11" } })).ok()).toBeTruthy();
    try {
      await page.goto("/#/");
      await page.getByRole("button", { name: "show only events" }).click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      const cal = preview.getByRole("region", { name: "calendar of the events" });
      await expect(cal).toBeVisible();
      await page.locator(".artifact-row", { hasText: "Cal probe launch" }).click();
      // Its month, on both days it spans, with the time on the first.
      await expect(cal.getByRole("heading")).toContainText("2026");
      await expect(cal.locator("[data-day='2026-03-10'] [data-event='2026-03-10-cal-probe-launch']")).toContainText("14:00");
      await expect(cal.locator("[data-day='2026-03-11'] [data-event='2026-03-10-cal-probe-launch']")).toHaveAttribute("aria-pressed", "true");
      await expect(preview.getByRole("heading", { level: 2, name: "Cal probe launch" })).toBeVisible();
      await cal.getByRole("button", { name: "next month" }).click();
      await expect(cal.locator("[data-event='2026-03-10-cal-probe-launch']")).toHaveCount(0);
    } finally {
      await request.delete("/api/events/2026-03-10-cal-probe-launch");
      await request.put("/api/settings", { data: { events: { enabled: false } } });
    }
  });

  test("workflows are artifacts too: a tile, rows, and the workflow's own view on the right", async ({ page }) => {
    const dir = path.join(fixture(), "workflows", "artifact-probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "workflow.yml"), "name: artifact-probe\ndescription: writes a stamp\nsteps:\n  - name: stamp\n    run: date > stamp.txt\n");
    const wf = { slug: "artifact-probe", name: "artifact-probe" };
    try {
    await page.goto("/#/");
    const tiles = page.getByRole("region", { name: "kinds" });
    await tiles.getByRole("button", { name: "show only workflows" }).click();
    await expect(page).toHaveURL(/kind=workflows/);
    const rows = page.locator(".artifact-row");
    await expect(rows.first()).toHaveAttribute("data-artifact", "workflows");
    await rows.filter({ hasText: wf!.name || wf!.slug }).first().click();
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview.getByRole("heading", { level: 2, name: wf!.name || wf!.slug })).toBeVisible();
    await expect(preview.getByRole("link", { name: "open" })).toHaveAttribute("href", `#/workflows/${wf!.slug}`);
    // The workflow's own view, in the column.
    await expect(preview).toContainText("writes a stamp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs are in the stream: the one under way is pinned under Now, a row shows the run on the right", async ({ page }) => {
    const root = fixture();
    const ids = ["2025-01-02-1000-00-stream-probe", "2025-01-02-1100-00-stream-probe"];
    const seed = (id: string, request: string, events: object[], ts: string) => {
      const dir = path.join(root, "output", "runs", id);
      mkdirSync(dir, { recursive: true });
      const all = [{ event: "run_start", ts, workflow: "stream-probe", request, steps: [{ name: "go", kind: "script" }] }, { event: "phase_start", ts, phase: "go", kind: "script" }, ...events];
      writeFileSync(path.join(dir, "trace.jsonl"), all.map((e) => JSON.stringify(e)).join("\n") + "\n");
    };
    const old = "2025-01-02T10:00:00Z";
    seed(ids[0], "finished batch", [{ event: "phase_end", ts: old, phase: "go", status: "ok", stats: { durationMs: 10, attempts: 1 } }, { event: "run_summary", ts: old, total: { durationMs: 10 } }], old);
    // Stamped now, so it counts as under way and not as stale.
    seed(ids[1], "live batch", [], new Date().toISOString());
    try {
      await page.goto("/#/");
      // The tiles come in groups: what you work with, what came out (workflow runs among it), what the agents know.
      const tiles = page.getByRole("region", { name: "kinds" });
      await expect(tiles.getByRole("group", { name: "Create" }).getByRole("button", { name: "show only workflows" })).toBeVisible();
      await expect(tiles.getByRole("group", { name: "Results" }).getByRole("button", { name: "show only workflow runs" })).toBeVisible();
      await expect(tiles.getByRole("group", { name: "Results" }).getByRole("button", { name: "show only presentations" })).toBeVisible();
      await expect(tiles.getByRole("group", { name: "Context" }).getByRole("button", { name: "show only knowledge" })).toBeVisible();

      // Unfiltered, the run under way leads the stream.
      const rows = page.locator(".artifact-row");
      const live = rows.filter({ hasText: "live batch" });
      await expect(live).toHaveAttribute("data-live", "working");
      await expect(page.locator(".artifact-row[data-live]").first()).toBeVisible();
      await expect(page.getByRole("region", { name: "everything" })).toContainText("Now");
      await expect(rows.filter({ hasText: "finished batch" })).not.toHaveAttribute("data-live");

      await tiles.getByRole("button", { name: "show only workflow runs" }).click();
      await expect(page).toHaveURL(/kind=runs/);
      await expect(rows.first()).toContainText("live batch");
      await expect(rows.filter({ hasText: "finished batch" })).toContainText("Ran ");
      await rows.filter({ hasText: "finished batch" }).click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      await expect(preview.getByRole("heading", { level: 2, name: "stream-probe" })).toBeVisible();
      await expect(preview.getByRole("link", { name: "open", exact: true })).toHaveAttribute("href", `#/runs/${ids[0]}`);
      await expect(preview).toContainText("finished batch");
    } finally {
      for (const id of ids) rmSync(path.join(root, "output", "runs", id), { recursive: true, force: true });
    }
  });

  test("knowledge bundles are artifacts too: the bundle's own view on the right", async ({ page }) => {
    const dir = path.join(fixture(), "knowledge", "artifact-notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pricing.md"), "---\ntype: concept\ntitle: Pricing\n---\n\nWe bill monthly.\n");
    try {
      await page.goto("/#/");
      await page.getByRole("region", { name: "kinds" }).getByRole("button", { name: "show only knowledge" }).click();
      await expect(page).toHaveURL(/kind=knowledge/);
      const row = page.locator(".artifact-row", { hasText: "artifact-notes" });
      await expect(row).toContainText("concept");
      await row.click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      await expect(preview.getByRole("heading", { level: 2, name: "artifact-notes" })).toBeVisible();
      await expect(preview.getByRole("link", { name: "open" })).toHaveAttribute("href", "#/knowledge/artifact-notes");
      await expect(preview).toContainText("Pricing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skills are artifacts too: the workspace's skill, its page on the right", async ({ page }) => {
    const dir = path.join(fixture(), "skills", "artifact-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: artifact-skill\ndescription: writes the weekly digest\n---\n# Digest\n\nCollect the week's runs.\n");
    try {
      await page.goto("/#/");
      await page.getByRole("region", { name: "kinds" }).getByRole("button", { name: "show only skills" }).click();
      await expect(page).toHaveURL(/kind=skills/);
      const row = page.locator(".artifact-row", { hasText: "/artifact-skill" });
      await expect(row).toContainText("writes the weekly digest");
      await row.click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      await expect(preview.getByRole("heading", { level: 2, name: "/artifact-skill" })).toBeVisible();
      await expect(preview.getByRole("link", { name: "open" })).toHaveAttribute("href", "#/skills/artifact-skill");
      await expect(preview).toContainText("Collect the week's runs.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repositories are artifacts while the feature is on: branch and state on the row, changes on the right", async ({ page, request }) => {
    const tiles = page.getByRole("region", { name: "kinds" });
    await page.goto("/#/");
    await expect(tiles.getByRole("button", { name: "show only repos" })).toHaveCount(0);

    const ROOT = "kraftwerk-data/artifact-repos";
    // Turning repos on ignores their root in .gitignore: the fixture is shared (git-sync counts its changes), so it goes back as it was.
    const ignore = path.join(fixture(), ".gitignore");
    const ignoreBefore = existsSync(ignore) ? readFileSync(ignore, "utf8") : null;
    const dir = path.join(fixture(), ROOT, "probe-repo");
    mkdirSync(dir, { recursive: true });
    const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "probe@example.com");
    g("config", "user.name", "probe");
    g("config", "commit.gpgsign", "false");
    writeFileSync(path.join(dir, "README.md"), "# probe\n");
    g("add", ".");
    g("commit", "-qm", "first");
    writeFileSync(path.join(dir, "README.md"), "# probe\nchanged\n");
    expect((await request.put("/api/settings", { data: { repos: { enabled: true, root: ROOT } } })).ok()).toBeTruthy();
    try {
      await page.reload();
      await tiles.getByRole("button", { name: "show only repos" }).click();
      await expect(page).toHaveURL(/kind=repos/);
      const row = page.locator(".artifact-row", { hasText: "probe-repo" });
      await expect(row).toContainText("main · 1 changed");
      await row.click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      await expect(preview.getByRole("heading", { level: 2, name: "probe-repo" })).toBeVisible();
      await expect(preview.getByRole("link", { name: "open" })).toHaveAttribute("href", "#/repos/probe-repo");
      // The repo's own page, without its way back: the changed file and the commit.
      await expect(preview.locator(".repo-file[data-file='README.md']")).toBeVisible();
      await expect(preview.locator(".repo-commit")).toContainText("first");
      await expect(preview.getByRole("link", { name: "repositories" })).toHaveCount(0);
    } finally {
      await request.put("/api/settings", { data: { repos: { enabled: false } } });
      rmSync(path.join(fixture(), ROOT), { recursive: true, force: true });
      if (ignoreBefore === null) rmSync(ignore, { force: true });
      else writeFileSync(ignore, ignoreBefore);
    }
  });

  test("routines: an agent's own is listed and shown; a new one is defined on its own, with a project and an agent", async ({ page, request }) => {
    const yml = () => readFileSync(path.join(fixture(), "agents", "routines.yml"), "utf8");
    expect((await request.post("/api/agents", { data: { name: "Routine Owner", emoji: "🦉", harness: "claude", system: "x" } })).ok()).toBeTruthy();
    expect((await request.post("/api/agents/routine-owner/routines", { data: { name: "Night watch", schedule: "0 3 * * *", prompt: "Look over the logs." } })).ok()).toBeTruthy();
    page.on("dialog", (d) => void d.accept());
    try {
      await page.goto("/#/");
      const tiles = page.getByRole("region", { name: "kinds" });
      await tiles.getByRole("button", { name: "show only routines" }).click();
      await expect(page).toHaveURL(/kind=routines/);
      const preview = page.getByRole("complementary", { name: "Preview" });

      // The agent's own routine: who it asks, when next; shown, and edited on the agent's profile.
      const own = page.locator(".artifact-row", { hasText: "Night watch" });
      await expect(own).toContainText("🦉 Routine Owner");
      await expect(own).toContainText("next");
      await own.click();
      await expect(preview.getByRole("heading", { level: 2, name: "Night watch" })).toBeVisible();
      await expect(preview.locator(".routine-view")).toContainText("Look over the logs.");
      await expect(preview.getByRole("link", { name: /edit on Routine Owner's profile/ })).toHaveAttribute("href", "#/agents/routine-owner/info");

      // + makes one of the workspace's own: in the artifacts-probe project, for the agent.
      await tiles.getByRole("link", { name: "new routine" }).click();
      await expect(preview.getByRole("heading", { level: 2, name: "New routine" })).toBeVisible();
      await preview.getByRole("textbox", { name: "name" }).fill("Weekly digest");
      await preview.getByRole("textbox", { name: /prompt/ }).fill("Summarize the week.");
      const where = preview.getByRole("combobox", { name: "runs in" });
      const who = preview.getByRole("combobox", { name: "who" });
      await expect(who.locator("option").first()).toHaveText("🎩 Ralv");
      await where.selectOption("artifacts-probe");
      await expect(who.locator("option").first()).toHaveText("🧭 the project's assistant");
      await who.selectOption("routine-owner");
      await preview.getByRole("button", { name: "add the routine" }).click();
      await expect(page).toHaveURL(/open=routines%3A_%3Aweekly-digest/);
      await expect(preview.getByRole("heading", { level: 2, name: "Weekly digest" })).toBeVisible();
      const row = page.locator(".artifact-row", { hasText: "Weekly digest" });
      await expect(row).toContainText("🦉 Routine Owner");
      await expect(row).toContainText("📁 Artifacts probe");
      expect(yml()).toMatch(/project: artifacts-probe\n\s+agent: routine-owner/);

      // Back to the project's assistant: saved in place.
      await who.selectOption("");
      await preview.getByRole("button", { name: "save", exact: true }).click();
      await expect(row).toContainText("🧭 Assistant");
      expect(yml()).not.toContain("agent: routine-owner");
      expect(yml()).toContain("project: artifacts-probe");

      await preview.getByRole("button", { name: "delete" }).click();
      await expect(row).toHaveCount(0);
      await expect(preview).toContainText("Pick something");
    } finally {
      await request.delete("/api/routines/weekly-digest");
      await request.delete("/api/agents/routine-owner");
      rmSync(path.join(fixture(), "agents", "routines.yml"), { force: true });
    }
  });

  test("chats are artifacts too: the first tile, a row per chat, the conversation on the right", async ({ page, request }) => {
    const id = ((await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "kraftwerk" } } })).json()) as { id: string }).id;
    try {
      expect((await request.patch(`/api/chats/${id}`, { data: { title: "Plan the offsite" } })).ok()).toBeTruthy();
      await page.goto("/#/");
      const tiles = page.getByRole("region", { name: "kinds" });
      // First, before Workflows.
      await expect(tiles.getByRole("button").first()).toHaveAttribute("aria-label", "show only chats");
      await expect(tiles.getByRole("link", { name: "new chat" })).toHaveAttribute("href", "#/agents/chats");
      await tiles.getByRole("button", { name: "show only chats" }).click();
      await expect(page).toHaveURL(/kind=chats/);
      await expect(page.locator(".artifact-row:not([data-artifact='chats'])")).toHaveCount(0);

      const row = page.locator(".artifact-row", { hasText: "Plan the offsite" });
      await expect(row).toContainText("Ralv");
      await row.click();
      const preview = page.getByRole("complementary", { name: "Preview" });
      await expect(preview.getByRole("heading", { level: 2, name: "Plan the offsite" })).toBeVisible();
      // The conversation itself, to write in; "open" leads to it in the chat screen.
      await expect(preview.locator(".artifact-chat textarea")).toBeVisible();
      await expect(preview.getByRole("link", { name: "open" })).toHaveAttribute("href", `#/agents/chats/${id}`);
      // The rail keeps its Chats entry.
      await expect(page.locator(".rail a[href='#/agents/chats']")).toBeVisible();
    } finally {
      await request.delete(`/api/chats/${id}`);
    }
  });
});
