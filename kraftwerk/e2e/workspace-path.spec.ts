import { expect, test } from "@playwright/test";

/**
 * The web UI under the path form, /w/<slug>/: the page finds its workspace
 * in its own address, and its API calls and socket carry the prefix. The
 * e2e fixture's root folder is project/, so its slug is "project".
 */
test("the UI works under /w/<slug>/ and its requests carry the prefix", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.includes("/api/")) api.push(p);
  });
  const socket = page.waitForEvent("websocket");
  await page.goto("/w/project/#/agents/chats");
  await expect(page.getByRole("heading", { name: "new chat" })).toBeVisible();
  expect(new URL((await socket).url()).pathname).toBe("/w/project/api/ws");
  expect(api.length).toBeGreaterThan(0);
  expect(api.every((p) => p.startsWith("/w/project/api/")), api.join(", ")).toBe(true);
});
