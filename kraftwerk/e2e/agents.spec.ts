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
    await expect(page.locator(".empty-action .run-btn")).toHaveText(/create your first agent/);
    await expect(page.locator(".new-chat-panel")).toHaveCount(0);

    const dir = path.join(fixture(), "agents", SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agent.yml"), "name: Landing Probe\nemoji: 🧭\nharness: claude\n");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/agents/${SLUG}`));
    await expect(page.locator(".rail .rail-row.active")).toHaveAttribute("href", `#/agents/${SLUG}`);
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

  test("lands on the latest general chat, /chats/new on a fresh pane", async ({ page, request }) => {
    await page.goto("/#/agents/chats");
    await expect(page.getByRole("button", { name: "start chat" })).toBeVisible();

    const older = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } });
    ids.push(((await older.json()) as { id: string }).id);
    const newer = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "kraftwerk" } } });
    const latest = ((await newer.json()) as { id: string }).id;
    ids.push(latest);

    // Same hash as before, so a plain goto would not re-enter the route.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/agents/chats/${latest}$`));
    await expect(page.locator(".rail .rail-row.active")).toHaveAttribute("href", "#/agents/chats");

    await page.locator("a[href='#/agents/chats/new']").click();
    await expect(page).toHaveURL(/#\/agents\/chats\/new$/);
    await expect(page.getByRole("button", { name: "start chat" })).toBeVisible();

    // The sidebar entry itself goes back to the latest chat.
    await page.locator(".rail a[href='#/agents/chats']").click();
    await expect(page).toHaveURL(new RegExp(`#/agents/chats/${latest}$`));
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
    await expect(row.locator(`a.chip[href='#/vibeables/${APP}']`)).toBeVisible();
    expect(readFileSync(path.join(fixture(), "agents", SLUG, "agent.yml"), "utf8")).toMatch(new RegExp(`^vibeables:\\n  - ${APP}$`, "m"));

    await page.goto(`/#/agents/${SLUG}/chat/new`);
    const tab = page.locator(".ctx").getByRole("tab", { name: /vibeables/ });
    await expect(tab).toContainText("1");
    await tab.click();
    await expect(page.locator(`.ctx .ctx-row[href='#/vibeables/${APP}']`)).toBeVisible();
  });
});
