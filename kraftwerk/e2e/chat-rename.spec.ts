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

  test("the active tab renames its chat; Escape keeps the name", async ({ page, request }) => {
    await page.goto(`/#/agents/chats/${chatId}`);
    const tab = page.getByRole("tab", { name: /new chat/ });
    await expect(tab).toBeVisible();

    await tab.hover();
    await page.getByRole("button", { name: "rename new chat" }).click();
    const field = page.getByRole("textbox", { name: "chat name" });
    await expect(field).toBeFocused();
    await field.fill("Repo setup");
    await field.press("Enter");
    await expect(page.getByRole("tab", { name: /Repo setup/ })).toBeVisible();
    await expect.poll(async () => ((await (await request.get(`/api/chats/${chatId}`)).json()) as { meta: { title: string } }).meta.title).toBe("Repo setup");

    await page.getByRole("tab", { name: /Repo setup/ }).dblclick();
    await field.fill("something else");
    await field.press("Escape");
    await expect(page.getByRole("tab", { name: /Repo setup/ })).toBeVisible();
  });
});
