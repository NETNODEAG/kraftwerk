import { existsSync } from "node:fs";

/**
 * How to run "this same kraftwerk" as a new process: the node we run on
 * plus the bin script we were started from. Identical for global installs,
 * local node_modules, npx caches and a dev checkout (bin/kraftwerk.js
 * picks src/ vs dist/ itself). Shared by the `kraftwerk ui` supervisor and
 * the project-start feature so bin resolution lives in one place.
 *
 * If the bin file is gone (npx cache pruned, package removed) the
 * fallback is `npx @netnodeag/kraftwerk`, i.e. the registry's latest —
 * not the running version, but better than nothing.
 */
export function selfCommand(args: string[]): { cmd: string; args: string[] } {
  const bin = process.argv[1];
  if (bin && existsSync(bin)) return { cmd: process.execPath, args: [bin, ...args] };
  return { cmd: "npx", args: ["-y", "@netnodeag/kraftwerk", ...args] };
}
