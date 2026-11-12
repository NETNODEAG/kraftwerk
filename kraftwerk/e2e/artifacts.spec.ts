import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    await page.goto("/#/");
    await page.locator(".rail a[href='#/artifacts']").click();
    await expect(page).toHaveURL(/#\/artifacts$/);
    await expect(page.locator(".rail a[href='#/artifacts']")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

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

    await page.getByRole("button", { name: "search artifacts" }).click();
    await page.getByRole("searchbox", { name: "search artifacts" }).fill("quarterly");
    await expect(rows).toHaveCount(1);

    // A row selects: the deck shows on the right, its slides drawn; "open" leads to where it lives.
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview).toContainText("Pick an artifact");
    await rows.first().click();
    await expect(page).toHaveURL(/#\/artifacts\?open=presentations/);
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(preview.getByRole("heading", { level: 2, name: "Quarterly review" })).toBeVisible();
    await expect(preview.locator("[data-slide]")).toHaveCount(2);
    await preview.getByRole("link", { name: "open" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}/presentations/quarterly-review$`));
  });

  test("a contact shows on the right, to edit in place; close goes back to the hint", async ({ page }) => {
    await page.goto("/#/artifacts");
    await page.locator(".artifact-row", { hasText: "Erika Muster" }).click();
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview.getByRole("heading", { level: 2, name: "Erika Muster" })).toBeVisible();
    await expect(preview.locator("input").first()).toBeVisible();
    await preview.getByRole("link", { name: "close the preview" }).click();
    await expect(page).toHaveURL(/#\/artifacts$/);
    await expect(preview).toContainText("Pick an artifact");
  });

  test("places: a map of all of them; a place zooms in with its details", async ({ page, request }) => {
    expect((await request.put("/api/settings", { data: { places: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.post("/api/places", { data: { title: "Map probe office", lat: 47.05, lng: 8.3 } })).ok()).toBeTruthy();
    expect((await request.post("/api/places", { data: { title: "Map probe depot", lat: 46.95, lng: 7.45 } })).ok()).toBeTruthy();
    try {
      await page.goto("/#/artifacts");
      await page.getByRole("button", { name: "show only places" }).click();
      await expect(page).toHaveURL(/#\/artifacts\?kind=places$/);
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
      await page.goto("/#/artifacts");
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
    await page.goto("/#/artifacts");
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

  test("knowledge bundles are artifacts too: the bundle's own view on the right", async ({ page }) => {
    const dir = path.join(fixture(), "knowledge", "artifact-notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pricing.md"), "---\ntype: concept\ntitle: Pricing\n---\n\nWe bill monthly.\n");
    try {
      await page.goto("/#/artifacts");
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
});
