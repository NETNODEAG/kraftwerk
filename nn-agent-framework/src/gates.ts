import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Gates verify post-execution claims, never predictions: they run AFTER the
 * agent finishes and look only at the files it left behind. A gate returns
 * null (passed) or a human-readable failure that goes verbatim into the
 * correction prompt.
 *
 * Only workflow-agnostic gates live here; workflow-specific ones (schema
 * checks etc.) live next to their workflow and implement the same interface.
 */

export interface Gate {
  name: string;
  check(runDir: string): Promise<string | null>;
}

export const fileNonEmpty = (file: string): Gate => ({
  name: `file_non_empty(${file})`,
  async check(runDir) {
    try {
      const stats = await stat(path.join(runDir, file));
      return stats.size > 0 ? null : `${file} existiert, ist aber leer`;
    } catch {
      return `${file} wurde nicht geschrieben`;
    }
  },
});

/** No {{...}} template slots may survive a fill step. */
export const slotsFilled = (file: string): Gate => ({
  name: `slots_filled(${file})`,
  async check(runDir) {
    const content = await readFile(path.join(runDir, file), "utf8").catch(() => "");
    return content.includes("{{")
      ? `${file} enthaelt noch unausgefuellte {{...}} Slots`
      : null;
  },
});

/** Fixed template parts chosen by code must survive byte-identically. */
export const containsText = (file: string, needle: string, label: string): Gate => ({
  name: `contains(${file}, ${label})`,
  async check(runDir) {
    const content = await readFile(path.join(runDir, file), "utf8").catch(() => "");
    return content.includes(needle)
      ? null
      : `${file} enthaelt "${needle}" nicht mehr — der fixe Template-Teil wurde veraendert`;
  },
});
