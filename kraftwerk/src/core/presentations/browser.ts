import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A headless browser for the exports that need the HTML drawn: slide PNGs
 * (what an agent looks at), the PDF, and the HTML pieces of a PowerPoint
 * file. playwright-core drives it — its own downloaded Chromium when the
 * machine has one (`npx playwright install chromium`), else the installed
 * Google Chrome. Without either, callers fall back to the PowerPoint
 * model's raster (core/presentations/export.ts) and say so.
 */

type Page = {
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  goto(url: string, o?: { waitUntil?: "load" | "networkidle" }): Promise<unknown>;
  emulateMedia(o: { media: "print" | "screen" }): Promise<void>;
  locator(sel: string): { nth(i: number): { screenshot(o?: { type?: "png"; omitBackground?: boolean }): Promise<Buffer> }; count(): Promise<number> };
  pdf(o: Record<string, unknown>): Promise<Buffer>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

let reason = "";

/** Why the last launch failed (for the fallback's warning). */
export const browserProblem = (): string => reason;

async function launch(): Promise<Browser | null> {
  let pw: { chromium: { launch(o?: Record<string, unknown>): Promise<Browser> } };
  try {
    pw = (await import("playwright-core")) as unknown as typeof pw;
  } catch {
    reason = "playwright-core is not installed";
    return null;
  }
  const errors: string[] = [];
  for (const opts of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await pw.chromium.launch({ headless: true, ...opts });
    } catch (err) {
      errors.push((err as Error).message.split("\n")[0]);
    }
  }
  reason = `no browser to render with (run \`npx playwright install chromium\` or install Google Chrome): ${errors[0] ?? ""}`;
  return null;
}

/**
 * Open a standalone deck HTML (from html.ts) in print layout — every slide
 * stacked at its stage size, no scaling — and hand the page over. Null
 * when no browser can be started.
 */
export async function withDeckPage<T>(html: string, size: { width: number; height: number }, fn: (page: Page) => Promise<T>): Promise<T | null> {
  const browser = await launch();
  if (!browser) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kraftwerk-deck-"));
  const file = path.join(dir, "deck.html");
  try {
    await fs.writeFile(file, html);
    const page = await browser.newPage();
    await page.setViewportSize(size);
    await page.emulateMedia({ media: "print" });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready.then(() => true));
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
