/**
 * Playwright's web server: a fresh fixture project served by the real
 * inspector with the built frontend. The fixture root is written to
 * e2e/.fixture.json so specs can touch files in it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject } from "../test/helpers/project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const dist = path.join(pkg, "inspector", "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  const r = spawnSync("npm", ["run", "build:inspector"], { cwd: pkg, stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}

const fx = await makeProject();
await fx.write("knowledge/.env", "SECRET=1\n");
writeFileSync(path.join(here, ".fixture.json"), JSON.stringify({ root: fx.root }));

process.env.HOME = fx.home;
const { startInspector } = await import("../src/inspector/server.js");
const port = Number(process.env.E2E_PORT || 19981);
await startInspector({ outputDir: path.join(fx.root, "output"), staticDir: dist, port, projectRoot: fx.root });
console.log(`e2e inspector on http://127.0.0.1:${port} for ${fx.root}`);
