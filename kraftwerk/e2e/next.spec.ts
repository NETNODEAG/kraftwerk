import { expect, test } from "@playwright/test";

/**
 * Working through what needs you: real waiting requests from the scripted
 * fake agent (e2e/serve.ts sets KRAFTWERK_ACP_ADAPTER): an approval in an
 * agent's chat and a question in a project's chat. The rail counts them
 * where they lead, the bell lists them by owner, and "next" opens each one
 * with its card in view; answering takes it off the list.
 */
test.describe("next: what needs you", () => {
  let agentChat = "";
  let projectChat = "";

  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.put("/api/agents/nx-lisa", { data: { name: "Nx Lisa", emoji: "🦊", harness: "claude" } })).ok()).toBeTruthy();
    expect((await request.post("/api/projects", { data: { title: "Nx Relaunch", slug: "nx-relaunch" } })).status()).toBe(201);
    expect((await request.post("/api/projects/nx-relaunch/links", { data: { kind: "agents", target: "nx-lisa" } })).ok()).toBeTruthy();
    agentChat = ((await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "agent", slug: "nx-lisa" } } })).json()) as { id: string }).id;
    expect((await request.post(`/api/chats/${agentChat}/message`, { data: { text: "install the deps" } })).ok()).toBeTruthy();
    await expect.poll(async () => ((await (await request.get("/api/attention")).json()) as { items: unknown[] }).items.length).toBe(1);
    projectChat = ((await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "project", slug: "nx-relaunch" } } })).json()) as { id: string }).id;
    expect((await request.post(`/api/chats/${projectChat}/message`, { data: { text: "please ask a question" } })).ok()).toBeTruthy();
    await expect.poll(async () => ((await (await request.get("/api/attention")).json()) as { items: unknown[] }).items.length).toBe(2);
  });
  test.afterAll(async ({ request }) => {
    for (const id of [agentChat, projectChat]) if (id) await request.delete(`/api/chats/${id}`);
    await request.delete("/api/projects/nx-relaunch");
    await request.delete("/api/agents/nx-lisa");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("Home lists what needs you, owner first, and starts the way through", async ({ page }) => {
    await page.goto("/");
    const rows = page.locator(".today-section").first().locator(".today-row.waiting");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("🦊 Nx Lisa");
    await expect(rows.nth(1)).toContainText("📁 Nx Relaunch");
    await expect(rows.nth(0)).toContainText("needs approval");
    await page.getByRole("button", { name: /^start/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/agents/nx-lisa/chat/${agentChat}\\?focus=`));
  });

  test("counts in the rail, the bell by owner, next lands on each card", async ({ page }) => {
    await page.goto("/#/agents/chats");
    const next = page.locator(".next-btn");
    await expect(next.locator(".next-n")).toHaveText("2");
    await expect(page).toHaveTitle(/^\(2\) /);

    // The rail: the agent has one, its project two (its own question and its agent's approval).
    const agentRow = page.locator(".rail [aria-label='Agents'] a", { hasText: "Nx Lisa" });
    await expect(agentRow.locator("[data-ui=badge]")).toHaveText("1");
    await expect(page.locator(".rail a[data-project='nx-relaunch'] [data-ui=badge]")).toHaveText("2");

    // The bell: "needs you" grouped by whose it is, owner first.
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.locator(".notif-owner")).toHaveText(["🦊 Nx Lisa", "📁 Nx Relaunch"]);
    const needRows = page.locator(".notif-row.need");
    await expect(needRows).toHaveCount(2);
    await expect(needRows.nth(0)).toContainText("Run npm install");
    await expect(needRows.nth(0)).toContainText("needs approval · in install the deps");
    await expect(needRows.nth(1)).toContainText("Which environment should I deploy to?");
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 300);

    // next: the oldest first — the approval, in the agent's chat, its card in view and lit.
    await next.click();
    await expect(page).toHaveURL(new RegExp(`#/agents/nx-lisa/chat/${agentChat}\\?focus=`));
    const perm = page.locator(".perm-card.pending", { hasText: "Run npm install" });
    await expect(perm).toBeInViewport();
    await expect(perm).toHaveClass(/focus-flash/);
    // In plain words: who asks, what, and the answers; the turn waits for you instead of "working".
    await expect(perm.locator(".perm-who")).toHaveText("🦊 Nx Lisa asks for your OK");
    await expect(perm.getByRole("button", { name: "Don't allow" })).toBeVisible();
    await expect(page.locator(".chat-working.waiting")).toHaveText("🦊 Nx Lisa is waiting for you");
    await expect(page.locator(".composer textarea")).toHaveAttribute("placeholder", "Add to what Nx Lisa is doing…");

    // ⌥N: on to the question, in the project's chat.
    await page.keyboard.press("Alt+KeyN");
    await expect(page).toHaveURL(new RegExp(`#/projects/nx-relaunch/chat/${projectChat}\\?focus=`));
    await expect(page.locator(".question-card.pending")).toBeInViewport();
    await expect(page.locator(".question-card .perm-who")).toHaveText("The assistant asks");

    // Back to the approval, answer it: one left.
    await next.click();
    await perm.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(next.locator(".next-n")).toHaveText("1");
    await expect(agentRow.locator("[data-ui=badge]")).toHaveCount(0);
  });
});
