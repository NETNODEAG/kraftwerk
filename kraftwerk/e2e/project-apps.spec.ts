import { expect, test } from "@playwright/test";

/**
 * Apps in a project: a vibeable pinned in the project's context column
 * shows under the project in the rail, opens from there at full size
 * (and back beside the project's chat), and leaves the rail when unpinned. No message is sent, so no
 * agent spawns.
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

  test("pin an app, open it from the rail, unpin it", async ({ page, request }) => {
    const chat = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "project", slug: PROJECT } } });
    const { id } = (await chat.json()) as { id: string };
    await page.goto(`/#/projects/${PROJECT}/chat/${id}`);

    const appRow = page.locator(`.rail a[data-nested='app'][href='#/projects/${PROJECT}?app=kanban']`);
    await expect(appRow).toHaveCount(0);

    await page.getByRole("tab", { name: /apps/ }).click();
    await page.getByRole("combobox", { name: "pin an app to this project" }).selectOption("kanban");
    await expect(appRow).toBeVisible();
    await expect(appRow).toContainText("kanban");
    // Pinned apps leave the picker.
    await expect(page.getByRole("combobox", { name: "pin an app to this project" }).locator("option", { hasText: "kanban" })).toHaveCount(0);
    expect(((await (await request.get(`/api/projects/${PROJECT}`)).json()) as { vibeables: string[] }).vibeables).toEqual(["kanban"]);

    // From elsewhere, the rail entry brings the project back with the app open beside its chat.
    await page.goto("/#/agents/chats");
    await page.getByRole("tab", { name: /workflows/ }).click();
    // The project you were last in stays open elsewhere; only its chevron folds it.
    await expect(appRow).toBeVisible();
    await page.getByRole("button", { name: "collapse Apps probe" }).click();
    await expect(appRow).toHaveCount(0);
    await page.getByRole("button", { name: "expand Apps probe" }).click();
    await appRow.click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}/chat/${id}$`));
    await expect(page.getByRole("tab", { name: /apps/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".ctx-embed-vibe:not([hidden])")).toBeVisible();
    // From the rail the app opens at full size, in the chat's place, under the project's title.
    await expect(page.locator(".ctx[data-full]")).toBeVisible();
    await expect(page.locator(".col-chat")).toBeHidden();
    await expect(page.locator(".space-title")).toContainText("Apps probe");
    await page.getByRole("button", { name: "beside the chat" }).click();
    await expect(page.locator(".ctx[data-full]")).toHaveCount(0);
    await expect(page.locator(".col-chat")).toBeVisible();

    await page.getByRole("button", { name: /Back to the list/ }).click();
    await page.locator(".ctx a[href='#/vibeables/kanban']").hover();
    await page.getByRole("button", { name: "unpin kanban" }).click();
    await expect(appRow).toHaveCount(0);
  });
});
