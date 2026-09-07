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
    await expect(page.locator(".side-row.active .side-wf")).toContainText(/Landing Probe/);
  });
});
