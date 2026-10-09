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
const dist = path.join(pkg, "web", "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  const r = spawnSync("npm", ["run", "build:web"], { cwd: pkg, stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}

const fx = await makeProject();
await fx.write("knowledge/.env", "SECRET=1\n");
writeFileSync(path.join(here, ".fixture.json"), JSON.stringify({ root: fx.root }));

process.env.HOME = fx.home;
process.env.KRAFTWERK_CLOUD_URL = "off"; // never register the e2e fixture with the real cloud
// A message in an e2e chat reaches the scripted fake agent, never a real one (it asks for one approval per prompt).
process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../test/helpers/fake-acp-agent.mjs");
const { startInspector } = await import("../src/server/server.js");
const port = Number(process.env.E2E_PORT || 19981);
await startInspector({ outputDir: path.join(fx.root, "output"), staticDir: dist, port, root: fx.root });
// The same workspace as a device on the network sees it: nothing without pairing (devices.spec.ts).
await startInspector({ outputDir: path.join(fx.root, "output"), staticDir: dist, port: port + 1, root: fx.root, trustLoopback: false });
// The same workspace served by a daemon, by its slug (project.localhost — the fixture's folder is project/): daemon.spec.ts.
const { startHub } = await import("../src/server/server.js");
const daemon = await startHub({ port: port + 2, staticDir: dist, daemon: true });
await daemon.open(fx.root);
console.log(`e2e inspector on http://127.0.0.1:${port} (as a remote device sees it: ${port + 1}; by a daemon: ${port + 2}) for ${fx.root}`);
