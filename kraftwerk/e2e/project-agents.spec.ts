import { expect, test } from "@playwright/test";

/**
 * An agent's chat filed under a project, in the browser: the project's
 * new-chat page offers its agents, a chat started there opens in the
 * project as the agent (named in the tab list), and an agent's own chat
 * can be filed under a project, or under none, from the strip. No message
 * is sent, so no agent spawns.
 */
test.describe("agents' chats in projects", () => {
  const chats: string[] = [];

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: true } } });
    expect((await request.post("/api/agents", { data: { name: "Desk Scout", emoji: "🔭", harness: "claude", system: "scout things" } })).ok()).toBe(true);
    expect((await request.post("/api/projects", { data: { title: "Moon base", slug: "moon-base" } })).status()).toBe(201);
    expect((await request.put("/api/projects/moon-base", { data: { agents: ["desk-scout"] } })).ok()).toBe(true);
  });
  test.afterAll(async ({ request }) => {
    for (const id of chats) await request.delete(`/api/chats/${id}`);
    await request.delete("/api/agents/desk-scout");
    await request.delete("/api/projects/moon-base");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("the project's agents start a chat filed under it, opened in the project", async ({ page, request }) => {
    await page.goto("/#/projects/moon-base/chat/new");
    const panel = page.getByText("or with an agent of the project");
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: /Desk Scout/ }).click();
    await expect(page).toHaveURL(/#\/projects\/moon-base\/chat\/chat-[\w-]+$/);
    const id = page.url().split("/chat/")[1];
    chats.push(id);
    const meta = (await (await request.get(`/api/chats/${id}`)).json()) as { meta: { scope: { kind: string; slug: string }; project?: string } };
    expect(meta.meta.scope).toMatchObject({ kind: "agent", slug: "desk-scout" });
    expect(meta.meta.project).toBe("moon-base");
    await page.getByRole("button", { name: "chats list" }).click();
    await expect(page.locator(`.sessions-side a[href='#/projects/moon-base/chat/${id}']`)).toContainText("with 🔭 Desk Scout");
  });

  test("an agent's chat is filed under a project from the strip, and under none again", async ({ page, request }) => {
    const created = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "agent", slug: "desk-scout" } } });
    const { id } = (await created.json()) as { id: string };
    chats.push(id);
    await page.goto(`/#/agents/desk-scout/chat/${id}`);
    const pick = page.getByRole("combobox", { name: "project" });
    await expect(pick).toHaveValue("");
    await pick.selectOption("moon-base");
    await expect.poll(async () => ((await (await request.get(`/api/chats/${id}`)).json()) as { meta: { project?: string } }).meta.project).toBe("moon-base");
    await page.getByRole("button", { name: "chats list" }).click();
    await expect(page.locator(`.sessions-side a[href='#/agents/desk-scout/chat/${id}']`)).toContainText("📁 Moon base");
    await pick.selectOption("");
    await expect.poll(async () => ((await (await request.get(`/api/chats/${id}`)).json()) as { meta: { project?: string } }).meta.project).toBeUndefined();
  });
});
