import { expect, test } from "@playwright/test";

/**
 * Renaming a chat from its tab: the pencil on the active tab (or a
 * double-click) turns the name into a field; Enter saves it to the chat,
 * Escape keeps the old one. No message is sent, so no agent spawns.
 */
test.describe("chat rename", () => {
  let chatId = "";
  test.beforeAll(async ({ request }) => {
    chatId = ((await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } })).json()) as { id: string }).id;
  });
  test.afterAll(async ({ request }) => {
    if (chatId) await request.delete(`/api/chats/${chatId}`);
  });

  test("the session menu next to Ralv renames the chat; Escape keeps the name", async ({ page, request }) => {
    await page.goto(`/#/agents/chats/${chatId}`);
    const crumb = page.locator(".space-title .session-crumb");
    await expect(crumb).toContainText("new chat");

    await crumb.click();
    await page.getByRole("menuitem", { name: "rename" }).click();
    const field = page.getByRole("textbox", { name: "chat name" });
    await expect(field).toBeFocused();
    await field.fill("Repo setup");
    await field.press("Enter");
    await expect(crumb).toContainText("Repo setup");
    await expect.poll(async () => ((await (await request.get(`/api/chats/${chatId}`)).json()) as { meta: { title: string } }).meta.title).toBe("Repo setup");

    await crumb.click();
    await page.getByRole("menuitem", { name: "rename" }).click();
    await field.fill("something else");
    await field.press("Escape");
    await expect(crumb).toContainText("Repo setup");
  });

});
