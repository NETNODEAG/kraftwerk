import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Newest mtime under a folder, for "changed 5m ago" on lists of folders. A
 * directory's own mtime only moves when an entry is added or removed, not
 * when a file inside is edited, so the walk looks at files. Bounded: git
 * internals, dependencies and dot entries are skipped, depth is capped, and
 * a huge tree stops early — the number is a hint, not an audit.
 */
const SKIP = /^(\.git|node_modules|\.cache|\.vite|\.next|vendor|dist|build|target)$/;

export async function newestMtime(dir: string, depth = 0, budget = { files: 2_000 }): Promise<number> {
  let newest = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (budget.files-- <= 0) break;
    if (SKIP.test(e.name) || e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 4) newest = Math.max(newest, await newestMtime(abs, depth + 1, budget));
    } else {
      const st = await fs.stat(abs).catch(() => null);
      if (st) newest = Math.max(newest, st.mtimeMs);
    }
  }
  return newest;
}
