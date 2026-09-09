import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Projects in the browser: the flag hides the nav entry, settings turn it
 * on, a project is created from the form and lands on its page, the goal
 * is editable, and a chat opened inside it lists under the project — not
 * under the general chats. No message is ever sent, so no agent spawns.
 */
test.describe("projects", () => {
  let chatId = "";

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });
  test.afterAll(async ({ request }) => {
    await request.delete("/api/channels/relaunch-crew");
    await request.delete("/api/agents/crew-planner");
    if (chatId) await request.delete(`/api/chats/${chatId}`);
    await request.delete("/api/projects/relaunch-the-website");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("the nav has no projects entry until settings turn the feature on", async ({ page }) => {
    await page.goto("/#/agents/chats");
    await expect(page.getByRole("heading", { name: "new chat" })).toBeVisible();
    await expect(page.locator("nav a[href='#/projects']")).toHaveCount(0);

    await page.goto("/#/settings");
    await page.getByRole("checkbox", { name: /gather a goal, its brief/ }).check();
    // Leaving the root empty takes the default, kraftwerk-data/projects.
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8")).toMatch(/^projects: \{\}$/m);
    await expect(page.locator("nav a[href='#/projects']")).toBeVisible();
  });

  test("a project is created from the form, lands on its page, and the goal can be set", async ({ page }) => {
    await page.goto("/#/projects");
    await expect(page.getByRole("heading", { name: "new project" })).toBeVisible();
    await page.getByRole("textbox", { name: "project title" }).fill("Relaunch the website");
    await page.getByRole("textbox", { name: "project goal" }).fill("Ship the new site");
    await page.getByRole("button", { name: "create project" }).click();

    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website\/info$/);
    await expect(page.getByRole("heading", { name: "Relaunch the website" })).toBeVisible();
    const dir = path.join(fixture(), "kraftwerk-data", "projects", "relaunch-the-website");
    expect(existsSync(path.join(dir, "project.yml"))).toBe(true);
    expect(readFileSync(path.join(dir, "project.yml"), "utf8")).toMatch(/^goal: Ship the new site$/m);
    expect(existsSync(path.join(dir, "brief.md"))).toBe(true);

    await page.getByRole("textbox", { name: "goal" }).fill("Ship the new site by November");
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(dir, "project.yml"), "utf8")).toMatch(/^goal: Ship the new site by November$/m);

    // The sidebar lists it with its goal.
    await expect(page.locator("[data-project='relaunch-the-website']")).toContainText("Relaunch the website");
  });

  test("a chat opened in the project lists under it and not under the general chats", async ({ page, request }) => {
    await page.goto("/#/projects/relaunch-the-website");
    // No chat yet: the new-chat pane names the project and starts a chat on its harness.
    await expect(page.getByRole("heading", { name: "new chat in Relaunch the website" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^start chat/ })).toContainText("claude");
    await page.getByRole("button", { name: /^start chat/ }).click();
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website\/chat\/chat-/);
    chatId = page.url().split("/chat/")[1];

    const chats = (await (await request.get("/api/chats")).json()) as { chats: Array<{ id: string; scope: { kind: string; slug?: string } }> };
    const mine = chats.chats.find((c) => c.id === chatId);
    expect(mine?.scope).toEqual({ kind: "project", slug: "relaunch-the-website" });

    // A project chat can take coworkers, like an agent session.
    await expect(page.getByRole("button", { name: "add coworker" })).toBeVisible();

    // The project's chat column lists it; the general chats column does not.
    await expect(page.locator(`.runs-side a[href='#/projects/relaunch-the-website/chat/${chatId}']`)).toBeVisible();
    await page.goto("/#/agents/chats");
    await expect(page.locator(`a[href='#/agents/chats/${chatId}']`)).toHaveCount(0);

    // A bare project URL now lands on that chat.
    await page.goto("/#/projects/relaunch-the-website");
    await expect(page).toHaveURL(new RegExp(`#/projects/relaunch-the-website/chat/${chatId}$`));
  });

  test("with a coworker the chat is a channel session that stays in the project", async ({ page, request }) => {
    const agent = await request.post("/api/agents", { data: { name: "Crew Planner", emoji: "🗺️", harness: "claude", system: "plan things" } });
    expect(agent.ok()).toBe(true);
    const r = await request.post("/api/channels/from-chat", { data: { chatId, name: "Relaunch crew", members: ["crew-planner"], responder: "crew-planner" } });
    expect(r.ok()).toBe(true);

    await page.goto(`/#/projects/relaunch-the-website/chat/${chatId}`);
    // Channel mode, same URL: the members strip is there, and the column marks the session.
    await expect(page.getByRole("heading", { name: "#relaunch-crew" })).toBeVisible();
    await expect(page.locator(".channel-members .member-handle", { hasText: "@crew-planner" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/projects/relaunch-the-website/chat/${chatId}$`));
    const row = page.locator(`.runs-side a[href='#/projects/relaunch-the-website/chat/${chatId}']`);
    await expect(row).toContainText("channel session");
    await expect(row).toContainText("#relaunch-crew");
  });
});
