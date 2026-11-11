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
    await expect(page.getByRole("textbox", { name: "new session" })).toBeVisible();
    await expect(page.locator("nav a[href='#/projects']")).toHaveCount(0);

    await page.goto("/#/settings");
    await page.getByRole("checkbox", { name: /gather a goal, its brief/ }).check();
    // Leaving the root empty takes the default, kraftwerk-data/projects.
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8")).toMatch(/^projects: \{\}$/m);
    // Settings is a page of its own; the rail shows the new group once the columns are back.
    await page.goto("/#/agents/chats");
    await expect(page.locator("nav a[href='#/projects']")).toBeVisible();
  });

  test("a project is created from the form, lands on its page, and the goal can be set", async ({ page }) => {
    // "new project" from a conversation is a modal; escape leaves it even with the title field focused.
    await page.goto("/#/projects/new");
    const modal = page.getByRole("dialog", { name: "edit" });
    await expect(modal.getByRole("textbox", { name: "project title" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    await page.goto("/#/projects");
    await expect(page.getByRole("heading", { name: "new project" })).toBeVisible();
    await page.getByRole("textbox", { name: "project title" }).fill("Relaunch the website");
    await page.getByRole("textbox", { name: "project goal" }).fill("Ship the new site");
    await page.getByRole("button", { name: "create project" }).click();

    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website\/info$/);
    // The page is a modal over the conversation columns.
    await expect(page.getByRole("dialog", { name: "edit" }).getByRole("heading", { name: "Relaunch the website" })).toBeVisible();
    const dir = path.join(fixture(), "kraftwerk-data", "projects", "relaunch-the-website");
    expect(existsSync(path.join(dir, "project.yml"))).toBe(true);
    expect(readFileSync(path.join(dir, "project.yml"), "utf8")).toMatch(/^goal: Ship the new site$/m);
    expect(existsSync(path.join(dir, "brief.md"))).toBe(true);

    await page.getByRole("textbox", { name: "goal" }).fill("Ship the new site by November");
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(dir, "project.yml"), "utf8")).toMatch(/^goal: Ship the new site by November$/m);

    // The sidebar lists it with its goal.
    await expect(page.locator(".rail [data-project='relaunch-the-website']")).toContainText("Relaunch the website");
  });

  test("a chat opened in the project lists under it and not under the general chats", async ({ page, request }) => {
    await page.goto("/#/projects/relaunch-the-website");
    // The overview: a composer for a new session (the project's assistant by default) and the recent sessions, none yet.
    await expect(page.getByRole("textbox", { name: "new session" })).toHaveAttribute("placeholder", "New session in Relaunch the website");
    await expect(page.getByRole("button", { name: "session with" })).toContainText("Assistant");
    await expect(page.locator("section[aria-label='recent sessions']")).toContainText("No sessions yet");
    // Started without a message: no agent spawns.
    await page.getByRole("button", { name: "start session" }).click();
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website\/chat\/chat-/);
    chatId = page.url().split("/chat/")[1];

    const chats = (await (await request.get("/api/chats")).json()) as { chats: Array<{ id: string; scope: { kind: string; slug?: string } }> };
    const mine = chats.chats.find((c) => c.id === chatId);
    expect(mine?.scope).toEqual({ kind: "project", slug: "relaunch-the-website" });

    // No tabs: the session is named next to the project's title, and its chat actions follow it.
    await expect(page.locator(".session-tab")).toHaveCount(0);
    await expect(page.locator(".space-title .session-crumb")).toBeVisible();
    await expect(page.getByRole("button", { name: "add coworker" })).toBeVisible();

    // The context column's overview reads the project's memory: where it stands (state.md) and lately (log.md).
    const ctx = page.locator(".ctx");
    await ctx.getByRole("tab", { name: "overview" }).click();
    await expect(ctx.locator("section", { hasText: "where it stands" })).toContainText("Nothing recorded yet");
    await expect(ctx.locator("section", { hasText: "lately" })).toContainText("Created");

    // Renamed from the session menu; the title row and the overview's recents show the new name.
    await page.getByRole("button", { name: "session menu" }).click();
    await page.getByRole("menuitem", { name: "rename" }).click();
    await page.getByRole("textbox", { name: "chat name" }).fill("Kickoff");
    await page.keyboard.press("Enter");
    await expect(page.locator(".space-title .session-crumb")).toContainText("Kickoff");

    // The general chats do not know it.
    await page.goto("/#/agents/chats");
    await expect(page.locator(`a[href='#/agents/chats/${chatId}']`)).toHaveCount(0);

    // The project's title leads back to the overview, which lists the session.
    await page.goto(`/#/projects/relaunch-the-website/chat/${chatId}`);
    await page.locator(".space-title .project-home-link").click();
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website$/);
    const recent = page.locator(`.recent-session[data-chat='${chatId}']`);
    await expect(recent).toContainText("Kickoff");
    // Every recent row says who the session is with: here the project's assistant.
    await expect(recent.locator(".recent-agent")).toHaveText("🧭 Assistant");

    // The pencil on the sign edits the project in a modal over the conversation; escape closes it.
    await page.getByRole("link", { name: /edit the project/ }).click();
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website\/info$/);
    await expect(page.getByRole("dialog", { name: "edit" }).getByRole("textbox", { name: "goal" })).toHaveValue("Ship the new site by November");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website$/);
    await expect(page.getByRole("dialog", { name: "edit" })).toHaveCount(0);

    // A bare project URL stays on the overview; a recent row opens its session.
    await recent.getByRole("link").click();
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
    await expect(page.locator(".space-title .session-crumb")).toContainText("Relaunch crew");
    await page.locator(".space-title .project-home-link").click();
    const row = page.locator(`.recent-session[data-chat='${chatId}']`);
    await expect(row).toContainText("Relaunch crew");
    await expect(row.locator(".recent-agent")).toContainText("coworkers");
    await expect(row).toContainText("#relaunch-crew");
  });

  test("a project is deleted from its page, also in simple mode, into the trash", async ({ page, request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: true } } });
    expect((await request.post("/api/projects", { data: { title: "Scrap project", slug: "scrap-project" } })).status()).toBe(201);
    await page.addInitScript(() => localStorage.setItem("kw-expert", "off"));
    await page.goto("/#/projects/scrap-project/info");
    await expect(page.locator(".rail [data-project='scrap-project']")).toBeVisible();
    await page.getByRole("button", { name: "delete project" }).click();
    await page.getByRole("button", { name: "confirm delete" }).click();
    await expect(page).not.toHaveURL(/scrap-project/);
    await expect(page.locator(".rail [data-project='scrap-project']")).toHaveCount(0);
    expect(existsSync(path.join(fixture(), "kraftwerk-data", "projects", "scrap-project"))).toBe(false);
    const trash = (await (await request.get("/api/trash")).json()) as { entries: { kind: string; name: string }[] };
    expect(trash.entries.some((e) => e.kind === "projects" && e.name === "scrap-project")).toBe(true);
  });
});
