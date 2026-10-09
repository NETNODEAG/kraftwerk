import { expect, test } from "@playwright/test";

/**
 * The web UI served by the machine's daemon, at its workspace's own host
 * name: project.localhost (the e2e fixture's folder is project/). The
 * browser resolves *.localhost itself; every API call and the socket stay
 * on that host, and the daemon's own address lists the workspace.
 */
const daemonPort = Number(process.env.E2E_PORT || 19981) + 2;

test("a workspace at <slug>.localhost: the UI works and talks to its own host only", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) hosts.add(u.host);
  });
  const socket = page.waitForEvent("websocket");
  await page.goto(`http://project.localhost:${daemonPort}/#/agents/chats`);
  await expect(page.getByRole("heading", { name: "new chat" })).toBeVisible();
  expect(new URL((await socket).url()).host).toBe(`project.localhost:${daemonPort}`);
  expect([...hosts]).toEqual([`project.localhost:${daemonPort}`]);
});

test("the daemon's own address lists its workspaces", async ({ page }) => {
  await page.goto(`http://localhost:${daemonPort}/`);
  const link = page.getByRole("link", { name: "fixture" });
  await expect(link).toHaveAttribute("href", `http://project.localhost:${daemonPort}/`);
});
