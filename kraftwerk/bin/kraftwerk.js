#!/usr/bin/env node
// kraftwerk bin shim: the framework ships TypeScript source, so register
// the tsx loader (a regular dependency) and hand over to the CLI.
import { register } from "tsx/esm/api";
register();
await import("../src/cli/kraftwerk.ts");
