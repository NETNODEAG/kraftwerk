import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Vibeables in the browser: the flag hides the button, settings turn it on,
 * an app opens next to the chat, the preview follows a file edit, a new one
 * is created from the picker, the pane closes. The chat never gets a
 * message, so no agent is spawned.
 */
test.describe("vibeables", () => {
  let chatId = "";

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { vibeables: { enabled: false } } });
    const chat = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } });
    chatId = ((await chat.json()) as { id: string }).id;
  });
  test.afterAll(async ({ request }) => {
    if (chatId) await request.delete(`/api/chats/${chatId}`);
    await request.delete("/api/vibeables/demo");
    await request.delete("/api/vibeables/fresh-one");
    await request.put("/api/settings", { data: { vibeables: { enabled: false } } });
  });

  test("the chat offers no vibeable until settings turn the feature on", async ({ page }) => {
    await page.goto(`/#/agents/chats/${chatId}`);
    await expect(page.getByRole("heading", { name: "new chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "vibeable" })).toHaveCount(0);
    await expect(page.locator("nav a[href='#/vibeables']")).toHaveCount(0);

    await page.goto("/#/settings");
    await page.getByRole("checkbox", { name: /build small apps live/ }).check();
    // Leaving the root empty takes the default, kraftwerk-data/vibeables.
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8")).toMatch(/^vibeables: \{\}$/m);

    await page.goto(`/#/agents/chats/${chatId}`);
    await expect(page.getByRole("button", { name: "vibeable" })).toBeVisible();
    await expect(page.locator("nav a[href='#/vibeables']")).toBeVisible();
  });

  test("the vibeables screen lists apps newest first and opens one in a fresh chat", async ({ page, request }) => {
    expect((await request.post("/api/vibeables", { data: { name: "older" } })).status()).toBe(201);
    await new Promise((r) => setTimeout(r, 1_100));
    expect((await request.post("/api/vibeables", { data: { name: "newer" } })).status()).toBe(201);
    await page.goto("/#/vibeables");
    await expect(page.getByRole("heading", { name: "Vibeables" })).toBeVisible();
    const rows = page.locator(".vibeable-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-vibeable", "newer");
    await expect(rows.nth(1)).toHaveAttribute("data-vibeable", "older");

    // Editing the older one moves it to the top.
    writeFileSync(path.join(fixture(), "kraftwerk-data/vibeables/older/index.html"), "<!doctype html><h1>older, edited</h1>\n");
    await page.reload();
    await expect(page.locator(".vibeable-row").nth(0)).toHaveAttribute("data-vibeable", "older");

    await page.locator(".vibeable-row[data-vibeable=older]").getByRole("button", { name: "open in chat" }).click();
    await expect(page).toHaveURL(/#\/agents\/chats\/chat-/);
    await expect(page.locator(".vibeable-pane[data-vibe=older]")).toBeVisible();
    await expect(page.frameLocator(".vibeable-frame").getByRole("heading", { name: "older, edited" })).toBeVisible();
    const openedChat = /chats\/(chat-[^/]+)/.exec(page.url())?.[1];
    if (openedChat) await request.delete(`/api/chats/${openedChat}`);

    await page.goto("/#/vibeables");
    const row = page.locator(".vibeable-row[data-vibeable=newer]");
    await row.getByRole("button", { name: "remove" }).click();
    await row.getByRole("button", { name: "confirm remove" }).click();
    await expect(row).toHaveCount(0);
    await request.delete("/api/vibeables/older");
  });

  test("opens an app next to the chat and reloads the preview on a file change", async ({ page, request }) => {
    expect((await request.post("/api/vibeables", { data: { name: "demo" } })).status()).toBe(201);
    await page.goto(`/#/agents/chats/${chatId}`);
    await page.getByRole("button", { name: "vibeable" }).click();
    await expect(page.getByRole("dialog", { name: "Open a vibeable" })).toBeVisible();
    await page.locator(".vibeable-repo", { hasText: "demo" }).click();

    const pane = page.locator(".vibeable-pane[data-vibe=demo]");
    await expect(pane).toBeVisible();
    await expect(pane.locator(".vibeable-mode")).toContainText("static");
    const frame = page.frameLocator(".vibeable-frame");
    await expect(frame.getByRole("heading", { name: "demo" })).toBeVisible();
    await expect(page.locator(".chat-thread .rid")).toContainText(path.join("kraftwerk-data/vibeables/demo"));

    writeFileSync(path.join(fixture(), "kraftwerk-data/vibeables/demo/index.html"), "<!doctype html><h1>changed by the agent</h1>\n");
    await expect(frame.getByRole("heading", { name: "changed by the agent" })).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.locator(".vibeable-pane[data-vibe=demo]")).toBeVisible();

    await page.getByRole("button", { name: "close preview" }).click();
    await expect(page.locator(".vibeable-pane")).toHaveCount(0);
    await expect(page.locator(".chat-thread .rid")).not.toContainText("vibeables/demo");
  });

  test("creates a new app from the picker", async ({ page }) => {
    await page.goto(`/#/agents/chats/${chatId}`);
    await page.getByRole("button", { name: "vibeable" }).click();
    await page.getByRole("textbox", { name: "new vibeable name" }).fill("fresh-one");
    await page.getByRole("button", { name: "create" }).click();
    await expect(page.locator(".vibeable-pane[data-vibe=fresh-one]")).toBeVisible();
    await expect(page.frameLocator(".vibeable-frame").getByRole("heading", { name: "fresh-one" })).toBeVisible();
    const view = (await (await page.request.get("/api/vibeables")).json()) as { vibeables: { slug: string }[] };
    expect(view.vibeables.map((v) => v.slug)).toContain("fresh-one");
    await page.getByRole("button", { name: "close preview" }).click();
    await expect(page.locator(".vibeable-pane")).toHaveCount(0);
  });
});
