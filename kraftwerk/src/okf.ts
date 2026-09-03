import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";

/**
 * OKF (Open Knowledge Format) core — kraftwerk's "Context & Knowledge"
 * feature. Implements OKF v0.2 (github.com/GoogleCloudPlatform/knowledge-catalog):
 * a knowledge bundle is a directory of markdown files with YAML frontmatter,
 * one concept per file, plus the reserved index.md / log.md.
 *
 * Layout: <project>/knowledge/<bundle>/**\/*.md — each direct subdirectory of
 * the knowledge root is one bundle (the unit of distribution). The root is
 * configurable via `knowledge:` in kraftwerk.yml.
 *
 * Design decisions:
 * - Writes go through writeConcept()/verifyConcept() so provenance is
 *   enforced: every put stamps `generated: { by, at }`, appends to the
 *   bundle's log.md, and regenerates index.md. Frontmatter edits use the
 *   yaml Document API, so unknown keys and comments survive round-trips
 *   (spec §4.1 requires preserving unknown keys).
 * - index.md is fully derived from concept frontmatter — regeneration is
 *   idempotent, so concurrent writers and out-of-band edits self-heal on
 *   the next regen (or via fsck --fix).
 * - Consumers are permissive per spec §11: unknown types, missing optional
 *   families, and broken links never reject a concept.
 */

export const DEFAULT_KNOWLEDGE_DIR = "knowledge";
export const OKF_VERSION = "0.2";
const RESERVED = new Set(["index.md", "log.md"]);

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export type ConceptStatus = "draft" | "stable" | "deprecated";

export interface VerifiedEntry {
  by?: string;
  at?: string;
}

export interface SourceEntry {
  id?: string;
  resource?: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
}

export interface ConceptInfo {
  /** Concept ID: path within the bundle, `.md` stripped (spec §2). */
  id: string;
  bundle: string;
  type?: string;
  title: string;
  description?: string;
  tags: string[];
  status: ConceptStatus;
  trustTier: TrustTier;
  staleAfter?: string;
  stale: boolean;
  generated?: { by?: string; at?: string };
  verified: VerifiedEntry[];
  /** Frontmatter problem (missing block, bad YAML, missing type). */
  error?: string;
}

export interface ConceptDetail extends ConceptInfo {
  frontmatter: Record<string, unknown> | null;
  body: string;
  raw: string;
  sources: SourceEntry[];
}

export interface BundleInfo {
  name: string;
  concepts: number;
  /** Latest generated.at / verified.at across concepts, for sorting. */
  updatedAt?: string;
  okfVersion?: string;
}

export interface ValidationIssue {
  bundle: string;
  file: string;
  level: "error" | "warning";
  message: string;
}

/* ---------- paths ---------- */

export function knowledgeRoot(projectRoot: string, configured?: string): string {
  return path.resolve(projectRoot, configured ?? DEFAULT_KNOWLEDGE_DIR);
}

const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function safeBundleName(name: string): string {
  if (!BUNDLE_RE.test(name)) throw new Error(`invalid bundle name "${name}"`);
  return name;
}

/** Normalize a concept id: strip .md, forbid escapes and absolute paths. */
export function safeConceptId(id: string): string {
  const clean = id.replace(/\.md$/i, "").replace(/^\/+/, "");
  if (
    !clean ||
    clean.split("/").some((seg) => seg === "" || seg === "." || seg === ".." || seg.startsWith("."))
  ) {
    throw new Error(`invalid concept id "${id}"`);
  }
  const base = path.basename(clean).toLowerCase();
  if (base === "index" || base === "log") {
    throw new Error(`"${base}.md" is a reserved filename (spec §3.1), not a concept`);
  }
  return clean;
}

export function conceptFile(root: string, bundle: string, id: string): string {
  return path.join(root, safeBundleName(bundle), `${safeConceptId(id)}.md`);
}

/* ---------- frontmatter ---------- */

interface Split {
  fmText: string | null;
  body: string;
}

function splitFrontmatter(raw: string): Split {
  if (!raw.startsWith("---")) return { fmText: null, body: raw };
  const m = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fmText: null, body: raw };
  return { fmText: m[1], body: raw.slice(m[0].length) };
}

/** Bare `verified: { by, at }` mapping counts as a one-element list (§5.2). */
function normalizeVerified(v: unknown): VerifiedEntry[] {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const entry = e as Record<string, unknown>;
      return { by: asString(entry.by), at: asTimestamp(entry.at) };
    });
}

export function trustTier(verified: VerifiedEntry[]): TrustTier {
  if (verified.length === 0) return "unverified";
  return verified.some((v) => (v.by ?? "").startsWith("human:")) ? "human-reviewed" : "machine-confirmed";
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** YAML may parse unquoted ISO datetimes as Date objects — accept both. */
const asTimestamp = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

function parseConceptContent(bundle: string, id: string, raw: string): ConceptDetail {
  const { fmText, body } = splitFrontmatter(raw);
  const base: ConceptDetail = {
    id,
    bundle,
    title: path.basename(id),
    tags: [],
    status: "stable",
    trustTier: "unverified",
    stale: false,
    verified: [],
    frontmatter: null,
    body,
    raw,
    sources: [],
  };
  if (fmText === null) return { ...base, error: "no YAML frontmatter block" };

  let fm: unknown;
  try {
    fm = parseYaml(fmText);
  } catch (err) {
    return { ...base, error: `unparseable frontmatter: ${(err as Error).message}` };
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return { ...base, error: "frontmatter is not a mapping" };
  }
  const f = fm as Record<string, unknown>;
  const type = asString(f.type);
  const verified = normalizeVerified(f.verified);
  const gen =
    f.generated && typeof f.generated === "object"
      ? {
          by: asString((f.generated as Record<string, unknown>).by),
          at: asTimestamp((f.generated as Record<string, unknown>).at),
        }
      : undefined;
  const staleAfter = asTimestamp(f.stale_after);
  const status = asString(f.status);
  const sources = Array.isArray(f.sources)
    ? (f.sources.filter((s) => s && typeof s === "object") as Record<string, unknown>[]).map(
        (s): SourceEntry => ({
          id: asString(s.id),
          resource: asString(s.resource),
          title: asString(s.title),
          author: asString(s.author),
          usage_count: typeof s.usage_count === "number" ? s.usage_count : undefined,
          last_modified: asTimestamp(s.last_modified),
        })
      )
    : [];

  return {
    ...base,
    frontmatter: f,
    type,
    title: asString(f.title) ?? path.basename(id),
    description: asString(f.description),
    tags: Array.isArray(f.tags) ? f.tags.filter((t) => typeof t === "string") : [],
    status: status === "draft" || status === "deprecated" ? status : "stable",
    trustTier: trustTier(verified),
    staleAfter,
    stale: !!staleAfter && Date.now() >= Date.parse(staleAfter),
    generated: gen,
    verified,
    sources,
    error: type ? undefined : 'frontmatter has no "type" field (the only required key)',
  };
}

/* ---------- scanning ---------- */

async function walkMd(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...(await walkMd(path.join(dir, e.name), `${prefix}${e.name}/`)));
    else if (e.name.toLowerCase().endsWith(".md") && !RESERVED.has(e.name.toLowerCase())) {
      out.push(`${prefix}${e.name}`);
    }
  }
  return out.sort();
}

export async function listBundles(root: string): Promise<BundleInfo[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const bundles: BundleInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const concepts = await listConcepts(root, e.name);
    let updatedAt: string | undefined;
    for (const c of concepts) {
      for (const ts of [c.generated?.at, ...c.verified.map((v) => v.at)]) {
        if (ts && (!updatedAt || ts > updatedAt)) updatedAt = ts;
      }
    }
    bundles.push({
      name: e.name,
      concepts: concepts.length,
      updatedAt,
      okfVersion: await bundleOkfVersion(path.join(root, e.name)),
    });
  }
  return bundles.sort((a, b) => a.name.localeCompare(b.name));
}

async function bundleOkfVersion(bundleDir: string): Promise<string | undefined> {
  const raw = await fs.readFile(path.join(bundleDir, "index.md"), "utf8").catch(() => null);
  if (!raw) return undefined;
  const { fmText } = splitFrontmatter(raw);
  if (!fmText) return undefined;
  try {
    const fm = parseYaml(fmText);
    const v = (fm as Record<string, unknown>)?.okf_version;
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
  } catch {
    return undefined;
  }
}

export async function listConcepts(root: string, bundle: string): Promise<ConceptInfo[]> {
  const dir = path.join(root, safeBundleName(bundle));
  const files = await walkMd(dir);
  const concepts = await Promise.all(
    files.map(async (rel): Promise<ConceptInfo> => {
      const id = rel.replace(/\.md$/i, "");
      const raw = await fs.readFile(path.join(dir, rel), "utf8").catch(() => "");
      const { frontmatter, body, raw: _r, sources, ...info } = parseConceptContent(bundle, id, raw);
      return info;
    })
  );
  return concepts;
}

export async function getConcept(
  root: string,
  bundle: string,
  id: string
): Promise<ConceptDetail | null> {
  const file = conceptFile(root, bundle, id);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return null;
  return parseConceptContent(bundle, safeConceptId(id), raw);
}

/* ---------- writing ---------- */

const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Re-emit content with `generated: { by, at }` stamped, using the yaml
 * Document API so every other frontmatter key (and comments) round-trips.
 */
/**
 * Guarantee a frontmatter block: content saved without one (an editor
 * losing the `---` fence, plain text pasted into the UI) reuses the
 * existing file's frontmatter and becomes the new body; with no existing
 * frontmatter either, a minimal one is synthesized.
 */
function ensureFrontmatter(content: string, existingRaw: string | null): string {
  if (splitFrontmatter(content).fmText !== null) return content;
  const existingFm = existingRaw === null ? null : splitFrontmatter(existingRaw).fmText;
  const fm = existingFm ?? "type: Note";
  return `---\n${fm}\n---\n\n${content.replace(/^\n+/, "")}`;
}

function stampGenerated(raw: string, actor: string): string {
  const { fmText, body } = splitFrontmatter(raw);
  if (fmText === null) throw new Error("concept needs a YAML frontmatter block (--- ... ---)");
  const doc = parseDocument(fmText);
  if (doc.errors.length > 0) {
    throw new Error(`unparseable frontmatter: ${doc.errors[0].message}`);
  }
  const fm = doc.toJS() as Record<string, unknown> | null;
  if (!fm || typeof fm !== "object") throw new Error("frontmatter is not a mapping");
  if (typeof fm.type !== "string" || !fm.type.trim()) {
    doc.set("type", "Note"); // spec §4.1: type is required — default rather than reject
  }
  const node = doc.createNode({ by: actor, at: nowIso() });
  (node as { flow?: boolean }).flow = true;
  doc.set("generated", node);
  return `---\n${doc.toString().trimEnd()}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

export interface WriteResult {
  file: string;
  created: boolean;
  concept: ConceptDetail;
}

/**
 * The enforced write path: validates, stamps provenance, appends the
 * bundle log, and regenerates index.md.
 */
export async function writeConcept(
  root: string,
  bundle: string,
  id: string,
  content: string,
  actor: string
): Promise<WriteResult> {
  const cleanId = safeConceptId(id);
  const file = conceptFile(root, bundle, cleanId);
  const existing = await fs.readFile(file, "utf8").catch(() => null);
  const stamped = stampGenerated(ensureFrontmatter(content, existing), actor);
  const created = existing === null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, stamped);
  const concept = parseConceptContent(bundle, cleanId, stamped);
  const label = concept.title === path.basename(cleanId) ? cleanId : concept.title;
  await appendLog(
    root,
    bundle,
    `**${created ? "Creation" : "Update"}**: ${created ? "Created" : "Updated"} [${label}](/${cleanId}.md) (${actor}).`
  );
  await regenerateIndex(root, bundle);
  return { file, created, concept };
}

/** Append a verification event (`verified: [{ by, at }]`) to a concept. */
export async function verifyConcept(
  root: string,
  bundle: string,
  id: string,
  actor: string
): Promise<ConceptDetail> {
  const cleanId = safeConceptId(id);
  const file = conceptFile(root, bundle, cleanId);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) throw new Error(`concept ${bundle}/${cleanId} not found`);
  const { fmText, body } = splitFrontmatter(raw);
  if (fmText === null) throw new Error("concept has no frontmatter to verify");
  const doc = parseDocument(fmText);
  if (doc.errors.length > 0) throw new Error(`unparseable frontmatter: ${doc.errors[0].message}`);

  const existing = normalizeVerified((doc.toJS() as Record<string, unknown> | null)?.verified);
  const entries = [...existing, { by: actor, at: nowIso() }];
  const node = doc.createNode(entries);
  for (const item of (node as { items?: Array<{ flow?: boolean }> }).items ?? []) item.flow = true;
  doc.set("verified", node);

  const next = `---\n${doc.toString().trimEnd()}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
  await fs.writeFile(file, next);
  await appendLog(root, bundle, `**Verification**: Verified [${cleanId}](/${cleanId}.md) (${actor}).`);
  return parseConceptContent(bundle, cleanId, next);
}

/* ---------- index + log ---------- */

/**
 * Derived, idempotent bundle-root index.md (§8): one section per top-level
 * subdirectory plus a root section, entries pulled from frontmatter.
 */
export async function regenerateIndex(root: string, bundle: string): Promise<void> {
  const dir = path.join(root, safeBundleName(bundle));
  const concepts = await listConcepts(root, bundle);
  const groups = new Map<string, ConceptInfo[]>();
  for (const c of concepts) {
    const top = c.id.includes("/") ? c.id.slice(0, c.id.indexOf("/")) : "";
    const list = groups.get(top) ?? [];
    list.push(c);
    groups.set(top, list);
  }
  const sections: string[] = [];
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  for (const key of keys) {
    const heading = key === "" ? bundle : key;
    const lines = groups
      .get(key)!
      .map((c) => `* [${c.title}](${c.id}.md)${c.description ? ` - ${c.description}` : ""}`);
    sections.push(`# ${heading}\n\n${lines.join("\n")}`);
  }
  const content =
    `---\nokf_version: "${OKF_VERSION}"\n---\n\n` +
    (sections.length > 0 ? sections.join("\n\n") + "\n" : `# ${bundle}\n\n(no concepts yet)\n`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.md"), content);
}

/** Prepend an entry under today's date heading in the bundle's log.md (§9). */
export async function appendLog(root: string, bundle: string, entry: string): Promise<void> {
  const file = path.join(root, safeBundleName(bundle), "log.md");
  const today = nowIso().slice(0, 10);
  let raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) raw = `# ${bundle} Update Log\n`;
  const lines = raw.split("\n");
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
  if (todayIdx >= 0) {
    // Autosaving editors write the same concept many times in a row — one
    // log line per run of identical entries is enough.
    if (lines[todayIdx + 1]?.trim() === `* ${entry}`) return;
    lines.splice(todayIdx + 1, 0, `* ${entry}`);
  } else {
    // New day: insert right after the title (newest first).
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    lines.splice(titleIdx + 1, 0, "", `## ${today}`, `* ${entry}`);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

/* ---------- init / validate / search ---------- */

export async function initBundle(root: string, bundle: string): Promise<string> {
  const dir = path.join(root, safeBundleName(bundle));
  if (await fs.stat(dir).catch(() => null)) throw new Error(`bundle "${bundle}" already exists`);
  await fs.mkdir(dir, { recursive: true });
  await regenerateIndex(root, bundle);
  await appendLog(root, bundle, `**Initialization**: Created the ${bundle} bundle.`);
  return dir;
}

/** Conformance per §11 plus advisory warnings (missing provenance, stale). */
export async function validateBundle(root: string, bundle: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const dir = path.join(root, safeBundleName(bundle));
  for (const rel of await walkMd(dir)) {
    const id = rel.replace(/\.md$/i, "");
    const raw = await fs.readFile(path.join(dir, rel), "utf8").catch(() => "");
    const c = parseConceptContent(bundle, id, raw);
    if (c.error) issues.push({ bundle, file: rel, level: "error", message: c.error });
    else {
      if (!c.generated?.by) {
        issues.push({ bundle, file: rel, level: "warning", message: "no generated.by provenance — write via `kraftwerk knowledge put` to stamp it" });
      }
      if (c.stale) {
        issues.push({ bundle, file: rel, level: "warning", message: `stale since ${c.staleAfter}` });
      }
    }
  }
  return issues;
}

export interface SearchHit {
  bundle: string;
  id: string;
  title: string;
  type?: string;
  snippet: string;
}

export async function searchKnowledge(
  root: string,
  query: string,
  bundle?: string
): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const bundles = bundle ? [bundle] : (await listBundles(root)).map((b) => b.name);
  const hits: SearchHit[] = [];
  for (const b of bundles) {
    const dir = path.join(root, safeBundleName(b));
    for (const rel of await walkMd(dir)) {
      const raw = await fs.readFile(path.join(dir, rel), "utf8").catch(() => "");
      const idx = raw.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const c = parseConceptContent(b, rel.replace(/\.md$/i, ""), raw);
      const start = Math.max(0, idx - 60);
      const snippet = raw
        .slice(start, idx + q.length + 60)
        .replace(/\s+/g, " ")
        .trim();
      hits.push({ bundle: b, id: c.id, title: c.title, type: c.type, snippet });
    }
  }
  return hits;
}

/** Re-derive every bundle index; returns all validation issues found. */
export async function fsck(root: string, fix: boolean): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const b of await listBundles(root)) {
    issues.push(...(await validateBundle(root, b.name)));
    if (fix) await regenerateIndex(root, b.name);
  }
  return issues;
}
