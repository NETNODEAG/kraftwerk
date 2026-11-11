import { expect, test } from "@playwright/test";

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

    // A tile per enabled kind; the apps tile is missing while vibeables are off.
    const tiles = page.getByRole("region", { name: "make something new" });
    await expect(tiles.getByRole("link", { name: "Slides" })).toHaveAttribute("href", "#/presentations/new");
    await expect(tiles.getByRole("link", { name: "Contact" })).toBeVisible();
    await expect(tiles.getByRole("link", { name: "App" })).toHaveCount(0);

    const rows = page.locator(".artifact-row");
    await expect(rows.filter({ hasText: "Quarterly review" })).toContainText("Artifacts probe");
    await expect(rows.first()).toContainText("Erika Muster");

    await page.getByRole("tab", { name: "Contacts" }).click();
    await expect(rows.filter({ hasText: "Quarterly review" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "Erika Muster" })).toBeVisible();
    await page.getByRole("tab", { name: "All" }).click();

    await page.getByRole("button", { name: "search artifacts" }).click();
    await page.getByRole("searchbox", { name: "search artifacts" }).fill("quarterly");
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}/presentations/quarterly-review$`));
  });
});
