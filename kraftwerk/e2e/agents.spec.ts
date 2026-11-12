import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Where #/agents lands: on nothing but the create button while the workspace
 * has no agents, on the agent (its profile, since nobody has talked to it)
 * once one exists. No session is started, so no coding agent runs.
 */
test.describe("agents landing", () => {
  const SLUG = "landing-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "agents", SLUG), { recursive: true, force: true }));

  test("empty workspace shows only the create button, an agent becomes the landing", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kw-expert", "on"));
    await page.goto("/#/agents");
    await expect(page.getByRole("button", { name: /create your first agent/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "start chat" })).toHaveCount(0);

    const dir = path.join(fixture(), "agents", SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agent.yml"), "name: Landing Probe\nemoji: 🧭\nharness: claude\n");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/agents/${SLUG}`));
    await expect(page.locator(".rail a[aria-current='page']")).toHaveAttribute("href", `#/agents/${SLUG}`);
  });
});

/**
 * The "Ralv" entry (general chats): with no chats it shows the new-chat pane; once
 * chats exist it opens the most recent one, and /chats/new is the way to a
 * fresh pane. Chats are created over the API and never get a message, so
 * no coding agent runs.
 */
test.describe("general chats landing", () => {
  const ids: string[] = [];
  test.afterAll(async ({ request }) => {
    for (const id of ids) await request.delete(`/api/chats/${id}`);
  });

  test("Ralv's overview: a composer and the recent chats; an open chat is named next to Ralv, without tabs", async ({ page, request }) => {
    await page.goto("/#/agents/chats");
    // The rail's row to Ralv is "Chats".
    const chatRow = page.locator(".rail").getByRole("link", { name: "Chats", exact: true });
    await expect(chatRow).toHaveAttribute("href", "#/agents/chats");
    await expect(chatRow).toHaveAttribute("aria-current", "page");
    // Second, after Home and above Artifacts.
    await expect(page.locator(".rail a").nth(1)).toHaveAttribute("href", "#/agents/chats");
    await expect(page.locator(".rail a").nth(2)).toHaveAttribute("href", "#/artifacts");
    await expect(page.getByRole("textbox", { name: "new session" })).toHaveAttribute("placeholder", "New chat with Ralv");
    await expect(page.getByRole("button", { name: "session with" })).toContainText("Ralv");

    const older = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } });
    ids.push(((await older.json()) as { id: string }).id);
    const newer = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "kraftwerk" } } });
    const latest = ((await newer.json()) as { id: string }).id;
    ids.push(latest);

    // The bare route stays on the overview and lists both, newest first, each with Ralv.
    await page.reload();
    await expect(page).toHaveURL(/#\/agents\/chats$/);
    const rows = page.locator("section[aria-label='recent sessions'] .recent-session");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-chat", latest);
    await expect(rows.first().locator(".recent-agent")).toHaveText("🎩 Ralv");
    await expect(page.locator(".rail a[aria-current='page']")).toHaveAttribute("href", "#/agents/chats");

    await rows.first().locator("a").click();
    await expect(page).toHaveURL(new RegExp(`#/agents/chats/${latest}$`));
    await expect(page.locator(".session-tab")).toHaveCount(0);
    await expect(page.locator(".space-title .session-crumb")).toContainText("new chat");
    // The title leads back to the overview.
    await page.locator(".space-title .project-home-link").click();
    await expect(page).toHaveURL(/#\/agents\/chats$/);
  });

  test("project chats are listed too and open in their project", async ({ page, request }) => {
    const PROJECT = "chats-probe";
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.post("/api/projects", { data: { title: "Chats probe", slug: PROJECT } })).status()).toBe(201);
    try {
      const r = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "project", slug: PROJECT } } });
      const id = ((await r.json()) as { id: string }).id;
      ids.push(id);

      await page.goto("/#/agents/chats");
      const row = page.locator(`section[aria-label='recent sessions'] .recent-session[data-chat='${id}']`);
      await expect(row.locator(".recent-place")).toHaveText("📁 Chats probe");
      await expect(row.locator(".recent-agent")).toHaveText("🧭 Assistant");
      await row.locator("a").click();
      // The context switches to the project: its route, its row in the rail.
      await expect(page).toHaveURL(new RegExp(`#/projects/${PROJECT}/chat/${id}$`));
      await expect(page.locator(".rail a[aria-current='page']")).toHaveAttribute("href", `#/projects/${PROJECT}`);
    } finally {
      await request.delete(`/api/projects/${PROJECT}`);
      await request.put("/api/settings", { data: { projects: { enabled: false } } });
    }
  });
});

/**
 * Vibeables linked to an agent, like knowledge: the profile row saves the
 * link into agent.yml, and a session with the agent shows the linked app in
 * the context column. The agent and app come over the API; no session gets
 * a message, so no coding agent runs.
 */
test.describe("agent vibeables", () => {
  const SLUG = "vibe-owner";
  const APP = "owned-app";

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { vibeables: { enabled: true } } });
    expect((await request.post("/api/vibeables", { data: { name: APP } })).status()).toBe(201);
    const a = await request.post("/api/agents", { data: { name: "Vibe Owner", emoji: "🧱", harness: "claude", system: "build the app" } });
    expect(a.ok()).toBe(true);
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/agents/${SLUG}`);
    await request.delete(`/api/vibeables/${APP}`);
    await request.put("/api/settings", { data: { vibeables: { enabled: false } } });
  });

  test("the profile links an app into agent.yml and the agent's context column lists it", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kw-expert", "on"));
    await page.goto(`/#/agents/${SLUG}/info`);
    const row = page.locator(".agent-view [data-link-kind=vibeables]");
    await expect(row).toContainText("none linked");
    await row.getByRole("button", { name: "edit" }).click();
    await row.getByRole("checkbox", { name: new RegExp(APP) }).check();
    await row.getByRole("button", { name: "save" }).click();
    await expect(row.locator(`a[href='#/vibeables/${APP}']`)).toBeVisible();
    expect(readFileSync(path.join(fixture(), "agents", SLUG, "agent.yml"), "utf8")).toMatch(new RegExp(`^vibeables:\\n  - ${APP}$`, "m"));

    await page.goto(`/#/agents/${SLUG}/chat/new`);
    const tab = page.locator(".ctx").getByRole("tab", { name: /apps/ });
    await expect(tab).toContainText("1");
    await tab.click();
    await expect(page.locator(`.ctx a[href='#/vibeables/${APP}']`)).toBeVisible();

    // Unlink in the modal over the chat: the column follows as soon as the modal closes, not on its next tick.
    await page.locator(".space-title .ctx-edit").click();
    const modalRow = page.locator(".edit-modal [data-link-kind=vibeables]");
    await modalRow.getByRole("button", { name: "edit" }).click();
    await modalRow.getByRole("checkbox", { name: new RegExp(APP) }).uncheck();
    await modalRow.getByRole("button", { name: "save" }).click();
    await expect(modalRow).toContainText("none linked");
    await page.getByRole("button", { name: "close" }).click();
    await expect(page.locator(".edit-modal")).toHaveCount(0);
    // The tab stays (the same tabs everywhere); its count drops.
    await expect(page.locator(".ctx").getByRole("tab", { name: /apps/ })).toContainText("0", { timeout: 3_000 });
  });
});
