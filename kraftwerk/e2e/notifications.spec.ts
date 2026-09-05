import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * The bell in the top bar: an attention item raises the badge and the tab
 * title, the popover lists it, clicking it jumps to the page and marks it
 * read. A routine whose agent vanished is the one event a browser test can
 * cause without spawning a coding agent.
 */
test.describe("notifications bell", () => {
  test("shows, lists and clears an attention item", async ({ page, request }) => {
    const root = fixture();
    mkdirSync(path.join(root, "agents", "watcher"), { recursive: true });
    writeFileSync(path.join(root, "agents", "watcher", "agent.yml"), "name: Watcher\nharness: claude\n");

    await page.goto("/");
    const bell = page.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible();
    await expect(bell.locator(".notif-badge")).toHaveCount(0);

    const saved = await request.post("/api/agents/watcher/routines", {
      data: { name: "morning digest", schedule: "0 9 * * 1-5", prompt: "say hello", enabled: false },
    });
    expect(saved.ok()).toBeTruthy();
    const routine = (await saved.json()) as { id: string };
    rmSync(path.join(root, "agents", "watcher", "agent.yml"));
    const run = await request.post(`/api/agents/watcher/routines/${routine.id}/run`);
    expect(run.status()).toBe(400);

    const view = (await (await request.get("/api/notifications")).json()) as { unread: number; items: unknown[] };
    expect(view.unread, JSON.stringify(view)).toBe(1);
    // The bell polls every 5s.
    await expect(bell.locator(".notif-badge")).toHaveText("1", { timeout: 12_000 });
    await expect(page).toHaveTitle(/^\(1\) /);

    await bell.click();
    const row = page.locator(".notif-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("morning digest could not start");
    await expect(row).toContainText("not found");
    // A failure offers a diagnosis chat (not clicked here: it would start a coding agent).
    await expect(row.getByRole("button", { name: "diagnose" })).toBeVisible();
    await page.screenshot({ path: "test-results/notifications-bell.png" });

    await row.click();
    await expect(page).toHaveURL(/#\/agents\/watcher$/);
    // Actions apply at once — no wait for the next poll.
    await expect(bell.locator(".notif-badge")).toHaveCount(0, { timeout: 2000 });
    await expect(page).not.toHaveTitle(/^\(\d+\) /);

    await bell.click();
    await page.getByRole("button", { name: "clear" }).click();
    await expect(page.locator(".notif-row")).toHaveCount(0);
    await expect(page.locator(".notif-empty")).toBeVisible();
  });
});
