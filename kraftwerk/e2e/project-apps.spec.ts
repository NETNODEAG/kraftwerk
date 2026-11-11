import { expect, test } from "@playwright/test";

/**
 * Apps in a project: a vibeable pinned in the project's context column
 * shows on the project's overview, between the new-session composer and the
 * recents, opens from there at full size (and back beside the project's
 * chat), and leaves the overview when unpinned. The rail has no rows under
 * a project. No message is sent, so no agent spawns.
 */
test.describe("project apps", () => {
  const PROJECT = "apps-probe";
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true }, vibeables: { enabled: true } } })).ok()).toBeTruthy();
    for (const name of ["kanban", "notes-app"]) expect((await request.post("/api/vibeables", { data: { name } })).status()).toBe(201);
    expect((await request.post("/api/projects", { data: { title: "Apps probe", slug: PROJECT } })).status()).toBe(201);
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/projects/${PROJECT}`);
    for (const name of ["kanban", "notes-app"]) await request.delete(`/api/vibeables/${name}`);
    await request.put("/api/settings", { data: { projects: { enabled: false }, vibeables: { enabled: false } } });
  });

  test("pin an app, open it from the overview, unpin it", async ({ page, request }) => {
    await page.goto(`/#/projects/${PROJECT}`);
    const card = page.locator(`.projects-screen a.pinned-app[data-app='kanban']`);
    await expect(page.getByRole("region", { name: "recent sessions" })).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.getByRole("tab", { name: /apps/ }).click();
    await page.getByRole("combobox", { name: "pin an app to this project" }).selectOption("kanban");
    await expect(card).toBeVisible();
    await expect(card).toContainText("kanban");
    await expect(page.locator(".rail [data-nested]")).toHaveCount(0);
    // Pinned apps leave the picker.
    await expect(page.getByRole("combobox", { name: "pin an app to this project" }).locator("option", { hasText: "kanban" })).toHaveCount(0);
    expect(((await (await request.get(`/api/projects/${PROJECT}`)).json()) as { vibeables: string[] }).vibeables).toEqual(["kanban"]);

    // The card opens the app at full size, in the chat's place, under the project's title.
    await page.getByRole("tab", { name: /overview/ }).click();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}\\?app=kanban$`));
    await expect(page.getByRole("tab", { name: /apps/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".ctx-embed-vibe:not([hidden])")).toBeVisible();
    await expect(page.locator(".ctx[data-full]")).toBeVisible();
    await expect(page.locator(".col-chat")).toBeHidden();
    await expect(page.locator(".space-title")).toContainText("Apps probe");
    await page.getByRole("button", { name: "beside the chat" }).click();
    await expect(page.locator(".ctx[data-full]")).toHaveCount(0);
    await expect(page.locator(".col-chat")).toBeVisible();

    await page.getByRole("button", { name: /Back to the list/ }).click();
    await page.locator(".ctx a[href='#/vibeables/kanban']").hover();
    await page.getByRole("button", { name: "unpin kanban" }).click();
    await expect(card).toHaveCount(0);
  });
});
