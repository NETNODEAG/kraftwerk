#!/usr/bin/env node
// kraftwerk bin shim. Dev checkouts (src/ present, e.g. via npm link) run
// the TypeScript source through tsx so edits are always live — a stale
// dist/ can never shadow them. Published installs ship no src/, so they
// take the compiled dist/ path. KRAFTWERK_DIST=1 forces dist/ (e.g. to
// verify a build from the checkout).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../src/cli/kraftwerk.ts");
const dist = path.join(here, "../dist/cli/kraftwerk.js");

if (existsSync(src) && process.env.KRAFTWERK_DIST !== "1") {
  const { register } = await import("tsx/esm/api");
  register();
  await import(src);
} else if (existsSync(dist)) {
  await import(dist);
} else {
  console.error("kraftwerk: neither src/ nor dist/ found — broken install?");
  process.exit(1);
}
