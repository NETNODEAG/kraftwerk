import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * The status line under each agent's name in the rail. Idle states come
 * from the real server (an agent with a routine, one with a session, one
 * with neither); working and waiting need a live agent turn, which a test
 * never spawns, so /api/agent-status is answered by a stub for those.
 */
test.describe("agent status line", () => {
  const AGENTS = ["st-scout", "st-writer", "st-fresh"];
  test.afterAll(() => {
    for (const slug of AGENTS) rmSync(path.join(fixture(), "agents", slug), { recursive: true, force: true });
  });
  const row = (page: import("@playwright/test").Page, name: string) => page.locator(".rail [aria-label='Agents'] a", { hasText: name }).first();

  test.beforeAll(async ({ request }) => {
    for (const [slug, name] of [["st-scout", "Scout"], ["st-writer", "Writer"], ["st-fresh", "Fresh"]]) {
      expect((await request.put(`/api/agents/${slug}`, { data: { name, harness: "claude", description: `${name} description` } })).ok()).toBeTruthy();
    }
    // Scout: a routine due every hour, so always within the horizon.
    expect((await request.post("/api/agents/st-scout/routines", { data: { name: "Hourly sweep", schedule: "@hourly", prompt: "sweep" } })).ok()).toBeTruthy();
    // Writer: one session, never prompted.
    expect((await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "agent", slug: "st-writer" } } })).ok()).toBeTruthy();
  });

  test("idle agents: next routine, last active, or their description", async ({ page }) => {
    await page.goto("/#/agents/chats");
    await expect(row(page, "Scout").locator(".rail-status")).toHaveText(/^next: Hourly sweep · /);
    await expect(row(page, "Writer").locator(".rail-status")).toHaveText(/^last active (just now|\dm ago)$/);
    await expect(row(page, "Fresh").locator(".rail-status")).toHaveText("Fresh description");
    await expect(row(page, "Fresh")).toHaveAttribute("title", "Fresh description");
    await expect(page.locator(".rail [data-ui=dot]")).toHaveCount(0);
  });

  test("working and waiting: the line, its tone and the light next to the name", async ({ page }) => {
    const since = new Date(Date.now() - 4 * 60_000).toISOString();
    await page.route("**/api/agent-status", (route) =>
      route.fulfill({
        json: {
          "st-scout": { waiting: [{ chatId: "c1", title: "Deploy check" }], working: [{ chatId: "c2", title: "Sweep", since }] },
          "st-writer": { waiting: [], working: [{ chatId: "c3", title: "Competitor summary", since }, { chatId: "c4", title: "Notes" }] },
          "st-fresh": { waiting: [], working: [] },
        },
      })
    );
    // The stub answers HTTP; with the socket closed the rail falls back to polling it.
    await page.routeWebSocket("**/api/ws", (ws) => ws.close());
    await page.goto("/#/agents/chats");

    const scout = row(page, "Scout");
    await expect(scout.locator(".rail-status")).toHaveText("waiting for you · Deploy check");
    await expect(scout.locator(".rail-status")).toHaveClass(/\bwaiting\b/);
    // Waiting shows as the red count from /api/attention, not as a light.
    await expect(scout.locator("[data-ui=dot]")).toHaveCount(0);

    const writer = row(page, "Writer");
    await expect(writer.locator(".rail-status")).toHaveText("working · Competitor summary +1 · 4m");
    await expect(writer.locator(".rail-status")).toHaveClass(/\bworking\b/);
    await expect(writer.locator("[data-ui=dot]")).toHaveAttribute("data-tone", "working");

    const fresh = row(page, "Fresh");
    await expect(fresh.locator(".rail-status")).toHaveText("Fresh description");
    await expect(fresh.locator("[data-ui=dot]")).toHaveCount(0);
  });
});
