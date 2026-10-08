import { expect, test } from "@playwright/test";

/**
 * The page talks to the server over one socket: the rail's lists arrive as
 * pushed watches on /api/ws instead of polled requests, and a change made
 * elsewhere (here: the API) reaches the open page without a reload.
 */
test.describe("socket", () => {
  test.afterAll(async ({ request }) => {
    await request.delete("/api/agents/sock-new");
  });

  test("the rail is fed over /api/ws and shows an agent created elsewhere at once", async ({ page, request }) => {
    const opened = page.waitForEvent("websocket", (ws) => ws.url().endsWith("/api/ws"));
    await page.goto("/#/agents/chats");
    const ws = await opened;
    await ws.waitForEvent("framereceived", (f) => String(f.payload).includes('"watch"'));
    await expect(page.locator(".rail [aria-label='Agents']")).toBeVisible();

    expect((await request.put("/api/agents/sock-new", { data: { name: "Socket Newcomer", harness: "claude" } })).ok()).toBeTruthy();
    // The rail's agent list polls every 15 s; the push makes it near-instant.
    await expect(page.locator(".rail [aria-label='Agents'] a", { hasText: "Socket Newcomer" })).toBeVisible({ timeout: 3000 });
  });
});
