import { promises as fs } from "node:fs";

/** Exit code the `kraftwerk ui` supervisor treats as "relaunch me". */
export const RESTART_EXIT_CODE = 75;

/** Whether a supervisor is around to respawn us (set by `kraftwerk ui`). */
export const supervised = (): boolean => process.env.KRAFTWERK_UI_SUPERVISED === "1";

async function readPackage(): Promise<{ name?: string; version?: string }> {
  try {
    return JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8")) as { name?: string; version?: string };
  } catch {
    return {};
  }
}

/** Package version as it is on disk right now (re-read per call, detects upgrades). */
export async function getDiskVersion(): Promise<string> {
  return (await readPackage()).version ?? "";
}

/** Package version this process loaded with, read once. Works from src/ (tsx) and dist/ alike. */
let pkgVersion: string | undefined;
export async function getPkgVersion(): Promise<string> {
  pkgVersion ??= await getDiskVersion();
  return pkgVersion;
}

/** Package name from package.json (registry lookups). */
export async function getPkgName(): Promise<string> {
  return (await readPackage()).name ?? "";
}
