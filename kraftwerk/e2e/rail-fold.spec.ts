import { expect, test } from "@playwright/test";

/**
 * Folding projects in the rail: a project shows its agents only while you
 * are in it or opened it with the chevron, the choice survives a reload,
 * and the whole group collapses to the project you are in.
 */
test.describe("rail folding", () => {
  const PROJECTS = ["fold-alpha", "fold-beta", "fold-gamma"];
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.put("/api/agents/fold-helper", { data: { name: "Fold Helper", harness: "claude" } })).ok()).toBeTruthy();
    for (const slug of PROJECTS) {
      expect((await request.post("/api/projects", { data: { title: slug, slug } })).status()).toBe(201);
      expect((await request.post(`/api/projects/${slug}/links`, { data: { kind: "agents", target: "fold-helper" } })).ok()).toBeTruthy();
    }
  });
  test.afterAll(async ({ request }) => {
    for (const slug of PROJECTS) await request.delete(`/api/projects/${slug}`);
    await request.delete("/api/agents/fold-helper");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("per project, remembered, and the whole group", async ({ page }) => {
    const projectRow = (slug: string) => page.locator(`.rail a[data-project='${slug}']`);
    // A nested agent row sits right after its project's row wrapper.
    const helperUnder = (slug: string) => page.locator(`.rail div:has(> a[data-project='${slug}']) + div > a[data-nested]`);

    await page.goto("/#/projects/fold-alpha/chat/new");
    await expect(helperUnder("fold-alpha")).toBeVisible();
    await expect(helperUnder("fold-beta")).toHaveCount(0);

    await page.getByRole("button", { name: "expand fold-beta" }).click();
    await expect(helperUnder("fold-beta")).toBeVisible();
    await page.getByRole("button", { name: "collapse fold-alpha" }).click();
    await expect(helperUnder("fold-alpha")).toHaveCount(0);

    await page.reload();
    await expect(helperUnder("fold-beta")).toBeVisible();
    await expect(helperUnder("fold-alpha")).toHaveCount(0);

    await page.getByRole("button", { name: "collapse projects" }).click();
    await expect(projectRow("fold-alpha")).toBeVisible();
    await expect(projectRow("fold-beta")).toHaveCount(0);
    await expect(projectRow("fold-gamma")).toHaveCount(0);
    await page.locator(".rail").getByRole("button", { name: /\d+ more$/ }).click();
    await expect(projectRow("fold-gamma")).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("kw-rail-fold"));
  });
});
