import { promises as fs } from "node:fs";

/**
 * Parsed files, kept while they are unchanged on disk. The live watches
 * re-read the same files over and over (kraftwerk.yml, every chat's
 * meta.json, every run's trace.jsonl); one stat tells whether the parse
 * from last time still holds, which saves the open-read-close and the
 * parsing. A file counts as unchanged while its inode, size and mtime (in
 * nanoseconds) are, so a rewrite through the API, an agent or an editor is
 * read again at once.
 *
 * Callers get their own copy (`clone`) wherever they might change what
 * they got; the cache's value is never handed out to be mutated.
 */

interface Entry {
  key: string;
  value?: unknown;
  error?: unknown;
}

/** Enough for every meta.json and trace.jsonl of a busy machine; the oldest go first. */
const MAX_ENTRIES = 20_000;

const entries = new Map<string, Entry>();

function remember(file: string, entry: Entry): void {
  entries.delete(file);
  entries.set(file, entry);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/**
 * `parse(text)` of `file`, from the cache while the file is unchanged.
 * Rejects like `fs.readFile` when the file is missing, and with the parse
 * error (again, without re-reading) while a broken file stays broken.
 */
export async function readParsed<T>(file: string, parse: (text: string) => T, clone: (value: T) => T = (v) => v): Promise<T> {
  const st = await fs.stat(file, { bigint: true });
  const key = `${st.ino}:${st.size}:${st.mtimeNs}`;
  const hit = entries.get(file);
  if (hit?.key === key) {
    if ("error" in hit) throw hit.error;
    return clone(hit.value as T);
  }
  const text = await fs.readFile(file, "utf8");
  try {
    const value = parse(text);
    remember(file, { key, value });
    return clone(value);
  } catch (error) {
    remember(file, { key, error });
    throw error;
  }
}
