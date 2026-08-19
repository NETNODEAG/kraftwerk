#!/usr/bin/env node
// kraftwerk bin shim: published installs run the compiled dist/ output;
// npm-linked dev checkouts (no dist/) fall back to tsx + TypeScript source.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "../dist/cli/kraftwerk.js");

if (existsSync(dist)) {
  await import(dist);
} else {
  const { register } = await import("tsx/esm/api");
  register();
  await import("../src/cli/kraftwerk.ts");
}
