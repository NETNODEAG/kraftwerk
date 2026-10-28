import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { ENTITY_KINDS, entitiesRootFor, resolveWorkspace, type EntityKind, type ResolvedWorkspace } from "../config.js";
import { workspaceRoot } from "./context.js";
import { cleanRecords, recordLine, type SystemOfRecord } from "./records.js";
import { resolveRefs, type LinkState, type RefKind } from "./refs.js";
import { SLUG_RE, slugify } from "./slug.js";
import { moveToTrash } from "./trash.js";

/**
 * Contacts, places and events: the workspace's own records of who, where
 * and when. One Markdown file per entry under the kind's root (`contacts:`,
 * `places:`, `events:` in kraftwerk.yml, default kraftwerk-data/<kind>/):
 * the typed fields in YAML frontmatter, free notes in the body. Readable
 * and editable by people and agents, versioned by the workspace git,
 * deleted into the trash.
 *
 *   contacts/anna-meier.md            title, role, org, email, phone, place, url, tags, records + notes
 *   places/netnode-office.md          title, address, lat, lng, url, tags, records + notes
 *   events/2026-11-03-kickoff.md      title, start, end, place, contacts, project, url, tags, records + notes
 *
 * The three kinds share this store; each is a small definition (its
 * fields, how its slug derives, how it sorts, how it reads in one line).
 * Fields that point at other things (a contact's place, an event's place,
 * contacts and project) hold slugs and are resolved through the reference
 * registry (refs.ts), so a missing target is reported, never an error.
 * Systems of record say where the truth lives outside kraftwerk (CRM,
 * newsletter tool, calendar, Google Maps); a place without one gets a
 * Google Maps link derived from its coordinates or address.
 */

export interface EntityBase {
  slug: string;
  title: string;
  tags: string[];
  records: SystemOfRecord[];
  /** Frontmatter keys this kind does not define; kept verbatim across saves. */
  extra?: Record<string, unknown>;
}

export interface ContactDef extends EntityBase {
  role?: string;
  org?: string;
  email?: string;
  phone?: string;
  /** A place's slug (place:<slug>). */
  place?: string;
  url?: string;
}

export interface PlaceDef extends EntityBase {
  address?: string;
  lat?: number;
  lng?: number;
  url?: string;
  /** Derived, never written: the google-maps record's URL, else one from lat/lng or the address. */
  mapsUrl?: string;
}

export interface EventDef extends EntityBase {
  /** ISO date (2026-11-03) or date-time (2026-11-03T14:00, optionally with seconds and a zone). */
  start: string;
  end?: string;
  /** A place's slug. */
  place?: string;
  /** Contact slugs. */
  contacts: string[];
  /** A project's slug. */
  project?: string;
  url?: string;
}

export type FieldType = "text" | "email" | "url" | "number" | "date" | "list" | "ref" | "refs";

/** One typed frontmatter field beyond the shared ones (title, tags, records); drives validation, the CLI options and the web form. */
export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  /** For ref/refs: what the slugs point at. */
  refKind?: RefKind;
  required?: boolean;
  /** One line for the CLI option and the form's placeholder. */
  hint: string;
}

export interface EntityKindDef<D extends EntityBase = EntityBase, K extends EntityKind = EntityKind> {
  /** The literal kind, so a factory built on the definition yields `contacts.list` and `/api/contacts/:slug` as types. */
  kind: K;
  /** The token in references: contact in contact:anna-meier. */
  singular: string;
  /** Material icon name the UI shows for the kind. */
  icon: string;
  fields: FieldSpec[];
  /** The default slug of a new entry. */
  slugFor(def: D): string;
  /** List order. */
  sort(a: D, b: D): number;
  /** What says more than the title (role and org, address, date); "" when there is nothing. */
  detail(def: D): string;
  /** One line that stands for the entry in lists, link labels and agent context: the title with its detail. */
  describe(def: D): string;
  /** Checks across fields (an event's end after its start); throws the one error to show. */
  validate?(def: D): void;
  /** Fields computed on read and never written (a place's maps URL); every derived key is present, undefined when there is no value. */
  derive?(def: D): Partial<D>;
  /** The days an entry covers, for a `from`/`to` filter on the list: an entry counts while it is still running. */
  span?(def: D): { start: string; end: string };
}

export type EntitySummary<D extends EntityBase> = D & {
  /** Absolute file path. */
  path: string;
  updatedAt?: string;
  /** Set when the file's frontmatter is unusable; the rest shows defaults. */
  configError?: string;
};

export type EntityDetail<D extends EntityBase> = EntitySummary<D> & {
  /** The Markdown body. */
  notes: string;
  /** Per ref field (place, contacts, project): the referenced slugs and whether each exists. */
  links: Record<string, LinkState[]>;
};

export interface EntitiesView<D extends EntityBase> {
  enabled: boolean;
  root?: string;
  items: EntitySummary<D>[];
  /** Set when the feature is off or the root cannot be read. */
  error?: string;
}

/** Fields of a create or save: shared ones, the kind's, plus notes; every one optional. */
export type EntityInput = Record<string, unknown> & { title?: string; notes?: string; slug?: string };

/* ---------- the kinds ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/;

export const CONTACTS: EntityKindDef<ContactDef, "contacts"> = {
  kind: "contacts",
  singular: "contact",
  icon: "person",
  fields: [
    { name: "role", label: "role", type: "text", hint: "What they do (CTO, project lead)" },
    { name: "org", label: "organisation", type: "text", hint: "Company or organisation" },
    { name: "email", label: "email", type: "email", hint: "Email address" },
    { name: "phone", label: "phone", type: "text", hint: "Phone number" },
    { name: "place", label: "place", type: "ref", refKind: "places", hint: "Slug of the place they are usually at (place:<slug>)" },
    { name: "url", label: "website", type: "url", hint: "Profile or website, http(s)" },
  ],
  slugFor: (c) => slugify(c.title),
  sort: (a, b) => a.title.localeCompare(b.title),
  detail: (c) => [c.role, c.org].filter(Boolean).join(", "),
  describe: (c) => `${c.title}${CONTACTS.detail(c) ? ` (${CONTACTS.detail(c)})` : ""}`,
};

export const PLACES: EntityKindDef<PlaceDef, "places"> = {
  kind: "places",
  singular: "place",
  icon: "location_on",
  fields: [
    { name: "address", label: "address", type: "text", hint: "Street, number, postcode, town" },
    { name: "lat", label: "latitude", type: "number", hint: "Decimal degrees (47.05)" },
    { name: "lng", label: "longitude", type: "number", hint: "Decimal degrees (8.30)" },
    { name: "url", label: "website", type: "url", hint: "Website, http(s)" },
  ],
  slugFor: (p) => slugify(p.title),
  sort: (a, b) => a.title.localeCompare(b.title),
  detail: (p) => p.address ?? "",
  describe: (p) => `${p.title}${p.address ? ` — ${p.address}` : ""}`,
  validate: (p) => {
    if ((p.lat === undefined) !== (p.lng === undefined)) throw new Error("lat and lng go together");
    if (p.lat !== undefined && (p.lat < -90 || p.lat > 90)) throw new Error("lat must be between -90 and 90");
    if (p.lng !== undefined && (p.lng < -180 || p.lng > 180)) throw new Error("lng must be between -180 and 180");
  },
  derive: (p) => ({ mapsUrl: mapsUrl(p) }),
};

/** The Google Maps link of a place: its google-maps record, else its coordinates, else its address; undefined with none of them. */
export function mapsUrl(p: PlaceDef): string | undefined {
  const record = p.records.find((r) => r.kind === "google-maps" && r.url);
  if (record?.url) return record.url;
  if (p.lat !== undefined && p.lng !== undefined) return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  if (p.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`;
  return undefined;
}

export const EVENTS: EntityKindDef<EventDef, "events"> = {
  kind: "events",
  singular: "event",
  icon: "event",
  fields: [
    { name: "start", label: "start", type: "date", required: true, hint: "ISO date or date-time: 2026-11-03 or 2026-11-03T14:00" },
    { name: "end", label: "end", type: "date", hint: "ISO date or date-time, not before start" },
    { name: "place", label: "place", type: "ref", refKind: "places", hint: "Slug of the place (place:<slug>)" },
    { name: "contacts", label: "contacts", type: "refs", refKind: "contacts", hint: "Contact slugs, comma-separated" },
    { name: "project", label: "project", type: "ref", refKind: "projects", hint: "Slug of the project it belongs to" },
    { name: "url", label: "link", type: "url", hint: "Meeting link or page, http(s)" },
  ],
  slugFor: (e) => `${e.start.slice(0, 10)}-${slugify(e.title, 37)}`.replace(/-+$/, ""),
  sort: (a, b) => eventTime(a.start) - eventTime(b.start) || a.title.localeCompare(b.title),
  detail: (e) => `${e.start.replace("T", " ")}${e.end ? `–${e.end.replace("T", " ")}` : ""}`,
  describe: (e) => `${EVENTS.detail(e)} ${e.title}`,
  validate: (e) => {
    // A plain day as the end means "until the end of that day": start 14:00, end the same day is fine.
    if (e.end && eventTime(e.end, true) < eventTime(e.start)) throw new Error("end must not be before start");
  },
  span: (e) => ({ start: e.start, end: e.end ?? e.start }),
};

/**
 * When an event's ISO value happens, as a timestamp: a plain day is local
 * midnight (its end, when asked, the last moment of that day), a date-time
 * is what Date reads (local without a zone, else the zone it names) — so
 * values with different offsets order by the instant, not by their text.
 */
export function eventTime(iso: string, endOfDay = false): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d + (endOfDay ? 1 : 0)).getTime() - (endOfDay ? 1 : 0);
  }
  return Date.parse(iso);
}

export const ENTITY_DEFS: { [K in EntityKind]: EntityKindDef<any> } = { contacts: CONTACTS, places: PLACES, events: EVENTS };

export const entityDef = (kind: string): EntityKindDef | undefined => (ENTITY_KINDS as readonly string[]).includes(kind) ? ENTITY_DEFS[kind as EntityKind] : undefined;

/* ---------- root ---------- */

export async function openEntities(kind: EntityKind): Promise<{ project?: ResolvedWorkspace; root?: string; off?: boolean; error?: string }> {
  let project: ResolvedWorkspace;
  try {
    project = await resolveWorkspace(workspaceRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = entitiesRootFor(project, kind);
  if (!root) return { off: true, error: `${kind} are off (enable them in settings or add \`${kind}:\` to kraftwerk.yml)` };
  return { project, root };
}

/** Make sure the root exists; runs when the feature is switched on. */
export async function ensureEntitiesRoot(kind: EntityKind): Promise<void> {
  const opened = await openEntities(kind);
  if (opened.root) await fs.mkdir(opened.root, { recursive: true });
}

async function requireRoot(kind: EntityKind): Promise<string> {
  const opened = await openEntities(kind);
  if (!opened.root) throw new Error(opened.error ?? `${kind} are off`);
  return opened.root;
}

export function safeEntitySlug(def: EntityKindDef<any>, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid ${def.singular} name "${slug}"`);
  return slug;
}

/* ---------- fields ---------- */

const strList = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null || v === "") return [];
  const list = typeof v === "string" ? v.split(",") : v;
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) throw new Error(`${field} must be a list of names`);
  return [...new Set(list.map((x) => x.trim()).filter(Boolean))];
};

/** One field's raw value (frontmatter or input) -> its clean value, or undefined when empty; every problem is one error. */
function cleanField(spec: FieldSpec, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return spec.type === "list" || spec.type === "refs" ? [] : undefined;
  switch (spec.type) {
    case "text":
    case "email":
    case "url":
    case "date": {
      const s = typeof v === "number" || v instanceof Date ? (v instanceof Date ? v.toISOString() : String(v)) : v;
      if (typeof s !== "string") throw new Error(`${spec.name} must be a string`);
      const t = s.trim();
      if (!t) return undefined;
      if (spec.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error(`${spec.name} must be an email address`);
      if (spec.type === "url" && !/^https?:\/\//.test(t)) throw new Error(`${spec.name} must start with http:// or https://`);
      if (spec.type === "date") {
        // YAML reads a bare date as a Date; keep what the person wrote when it was a plain day.
        const iso = v instanceof Date && /T00:00:00\.000Z$/.test(t) ? t.slice(0, 10) : t.replace(/\.\d{3}Z$/, "Z");
        if (!DATE_RE.test(iso) || Number.isNaN(Date.parse(iso))) throw new Error(`${spec.name} must be an ISO date (2026-11-03) or date-time (2026-11-03T14:00)`);
        return iso;
      }
      return t;
    }
    case "number": {
      const n = typeof v === "string" ? Number(v.trim()) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${spec.name} must be a number`);
      return n;
    }
    case "list":
      return strList(v, spec.name);
    case "ref": {
      if (typeof v !== "string") throw new Error(`${spec.name} must be a ${spec.refKind} slug`);
      const t = v.trim().replace(new RegExp(`^${spec.refKind!.replace(/s$/, "")}:`), "");
      if (!t) return undefined;
      if (!SLUG_RE.test(t)) throw new Error(`${spec.name} must be a ${spec.refKind} slug (lowercase, digits, dashes)`);
      return t;
    }
    case "refs": {
      const prefix = new RegExp(`^${spec.refKind!.replace(/s$/, "")}:`);
      return strList(v, spec.name).map((t) => {
        const s = t.replace(prefix, "");
        if (!SLUG_RE.test(s)) throw new Error(`${spec.name} must be ${spec.refKind} slugs (lowercase, digits, dashes)`);
        return s;
      });
    }
  }
}

const SHARED = new Set(["title", "tags", "records"]);
/** Keys a read adds around the fields; a client that sends a GET body back must not write them into the file. */
const READ_ONLY = new Set(["slug", "notes", "extra", "path", "updatedAt", "configError", "links"]);

/** Frontmatter (or a save's fields) -> a clean definition, with unknown keys kept under `extra`. */
function buildDef<D extends EntityBase>(def: EntityKindDef<D>, slug: string, data: Record<string, unknown>): D {
  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : slug;
  const out: Record<string, unknown> = { slug, title, tags: strList(data.tags, "tags"), records: cleanRecords(data.records) };
  const known = new Set([...SHARED, ...READ_ONLY, ...def.fields.map((f) => f.name)]);
  for (const f of def.fields) {
    const v = cleanField(f, data[f.name]);
    if (v === undefined && f.required) throw new Error(`${f.name} is required`);
    if (v !== undefined) out[f.name] = v;
  }
  for (const k of Object.keys(def.derive?.(out as D) ?? {})) known.add(k);
  const extra = Object.fromEntries(Object.entries(data).filter(([k, v]) => !known.has(k) && v !== undefined));
  if (Object.keys(extra).length) out.extra = extra;
  const built = out as D;
  def.validate?.(built);
  return built;
}

const emptyDef = <D extends EntityBase>(def: EntityKindDef<D>, slug: string): D => {
  const out: Record<string, unknown> = { slug, title: slug, tags: [], records: [] };
  for (const f of def.fields) if (f.type === "refs" || f.type === "list") out[f.name] = [];
  // A required field cannot be empty; a placeholder keeps the broken file visible without lying about it.
  for (const f of def.fields) if (f.required && f.type === "date") out[f.name] = "0000-00-00";
  return out as D;
};

/** With the derived fields added (never written). */
const withDerived = <D extends EntityBase>(def: EntityKindDef<D>, d: D): D => ({ ...d, ...(def.derive?.(d) ?? {}) });

/* ---------- files ---------- */

/** Split a Markdown file into its frontmatter text and body; null frontmatter when the file has none. */
function splitFrontmatter(raw: string): { fm: string | null; body: string } {
  if (!raw.startsWith("---")) return { fm: null, body: raw };
  // An empty block (`---` straight after `---`) is frontmatter with nothing in it, not two lines of notes.
  const m = /^---[ \t]*\r?\n---[ \t]*(\r?\n|$)/.exec(raw) ?? /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw);
  if (!m) return { fm: null, body: raw };
  // The blank line toFile puts between the frontmatter and the body is a separator, not part of the notes.
  return { fm: m[1] ?? "", body: raw.slice(m[0].length).replace(/^\r?\n/, "") };
}

/** The file as written: frontmatter with the known fields in their order, extras after, then the notes. */
function toFile<D extends EntityBase>(def: EntityKindDef<D>, d: D, notes: string): string {
  const derived = new Set(Object.keys(def.derive?.(d) ?? {}));
  const doc: Record<string, unknown> = { title: d.title };
  const rec = d as unknown as Record<string, unknown>;
  for (const f of def.fields) {
    if (derived.has(f.name)) continue;
    const v = rec[f.name];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    doc[f.name] = v;
  }
  if (d.tags.length) doc.tags = d.tags;
  if (d.records.length) doc.records = d.records;
  for (const [k, v] of Object.entries(d.extra ?? {})) if (!(k in doc)) doc[k] = v;
  const body = notes.trim() ? `${notes.replace(/\s+$/, "")}\n` : "";
  return `---\n${stringify(doc)}---\n${body ? `\n${body}` : ""}`;
}

async function readFile<D extends EntityBase>(def: EntityKindDef<D>, root: string, slug: string): Promise<{ summary: EntitySummary<D>; notes: string } | null> {
  const file = path.join(root, `${slug}.md`);
  let raw: string;
  let st: { mtimeMs: number };
  try {
    [raw, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch {
    return null;
  }
  const updatedAt = new Date(st.mtimeMs).toISOString();
  const { fm, body } = splitFrontmatter(raw);
  try {
    const data = fm === null ? {} : (parse(fm) ?? {});
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter must be a mapping");
    return { summary: { ...withDerived(def, buildDef(def, slug, data as Record<string, unknown>)), path: file, updatedAt }, notes: body };
  } catch (err) {
    return { summary: { ...emptyDef(def, slug), path: file, updatedAt, configError: (err as Error).message }, notes: body };
  }
}

/* ---------- reads ---------- */

/** Every entry under the kind's root in the kind's order; `from`/`to` narrow kinds with a date (events) by it. */
export async function listEntities<D extends EntityBase>(def: EntityKindDef<D>, range: { from?: string; to?: string } = {}): Promise<EntitiesView<D>> {
  const opened = await openEntities(def.kind);
  if (!opened.root) return { enabled: false, items: [], error: opened.error };
  const root = opened.root;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name.slice(0, -3));
  let items = (
    await Promise.all(
      names.map(async (name): Promise<EntitySummary<D> | null> => {
        if (SLUG_RE.test(name)) return (await readFile(def, root, name))?.summary ?? null;
        // A file whose name is not a slug cannot be referenced or opened; it is listed with the reason rather than hidden.
        const file = path.join(root, `${name}.md`);
        const st = await fs.stat(file).catch(() => null);
        if (!st) return null;
        const configError = `file name must be a slug (lowercase letters, digits and dashes, up to 49 characters) — rename ${name}.md`;
        return { ...emptyDef(def, name), path: file, updatedAt: new Date(st.mtimeMs).toISOString(), configError } as EntitySummary<D>;
      }),
    )
  ).filter((x) => x != null);
  if (def.span && (range.from || range.to)) {
    const day = (iso: string) => iso.slice(0, 10);
    items = items.filter((i) => {
      if (i.configError) return false;
      const span = def.span!(i);
      // From: anything still running on that day; to: anything that has started by then.
      return (!range.from || day(span.end) >= day(range.from)) && (!range.to || day(span.start) <= day(range.to));
    });
  }
  items.sort(def.sort);
  return { enabled: true, root, items };
}

/** The ref fields' states: which referenced slugs exist right now. */
async function linksOf<D extends EntityBase>(def: EntityKindDef<D>, d: D): Promise<Record<string, LinkState[]>> {
  const rec = d as unknown as Record<string, unknown>;
  const refFields = def.fields.filter((f) => f.type === "ref" || f.type === "refs");
  const byKind: Partial<Record<RefKind, string[]>> = {};
  for (const f of refFields) {
    const slugs = f.type === "refs" ? ((rec[f.name] as string[] | undefined) ?? []) : rec[f.name] ? [rec[f.name] as string] : [];
    byKind[f.refKind!] = [...new Set([...(byKind[f.refKind!] ?? []), ...slugs])];
  }
  const resolved = await resolveRefs(byKind as Record<RefKind, string[]>);
  const links: Record<string, LinkState[]> = {};
  for (const f of refFields) {
    const slugs = f.type === "refs" ? ((rec[f.name] as string[] | undefined) ?? []) : rec[f.name] ? [rec[f.name] as string] : [];
    links[f.name] = slugs.map((s) => resolved[f.refKind!].find((l) => l.slug === s) ?? { slug: s, found: false });
  }
  return links;
}

/** One entry with its notes and link states; null when there is no such file. */
export async function getEntity<D extends EntityBase>(def: EntityKindDef<D>, slug: string): Promise<EntityDetail<D> | null> {
  const root = await requireRoot(def.kind);
  const read = await readFile(def, root, safeEntitySlug(def, slug));
  if (!read) return null;
  return { ...read.summary, notes: read.notes, links: await linksOf(def, read.summary) };
}

/* ---------- writes ---------- */

export async function createEntity<D extends EntityBase>(def: EntityKindDef<D>, input: EntityInput): Promise<EntityDetail<D>> {
  const root = await requireRoot(def.kind);
  const { notes, slug: wanted, ...fields } = input;
  if (typeof fields.title !== "string" || !fields.title.trim()) throw new Error("title is required");
  const d = buildDef(def, "new", fields);
  const slug = safeEntitySlug(def, (typeof wanted === "string" ? wanted.trim() : "") || def.slugFor(d) || def.singular);
  d.slug = slug;
  const file = path.join(root, `${slug}.md`);
  await fs.mkdir(root, { recursive: true });
  try {
    // Exclusive create: two writers racing for the same slug (the UI and an agent's CLI) cannot overwrite each other.
    await fs.writeFile(file, toFile(def, d, typeof notes === "string" ? notes : ""), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${def.singular} "${slug}" already exists`);
    throw err;
  }
  return (await getEntity(def, slug))!;
}

/** Merge the given fields into the frontmatter (and the notes when given); lists replace wholesale, "" clears a field. */
export async function saveEntity<D extends EntityBase>(def: EntityKindDef<D>, slug: string, input: EntityInput): Promise<EntityDetail<D>> {
  const current = await getEntity(def, slug);
  if (!current) throw new Error(`no ${def.singular} "${slug}"`);
  // A file that could not be read keeps what the person wrote: rewriting it from defaults would throw their frontmatter away.
  if (current.configError) throw new Error(`${def.singular} "${slug}" cannot be saved until its file is fixed by hand (${current.configError}): ${current.path}`);
  const { notes, slug: _ignored, ...given } = input;
  const { path: _p, updatedAt: _u, configError: _c, notes: _n, links: _l, extra, ...rest } = current;
  const derived = new Set(Object.keys(def.derive?.(current) ?? {}));
  const base: Record<string, unknown> = { ...extra, ...rest };
  for (const k of derived) delete base[k];
  for (const [k, v] of Object.entries(given)) if (v !== undefined) base[k] = v;
  if (given.title !== undefined && !(typeof given.title === "string" && given.title.trim())) throw new Error("title is required");
  const next = buildDef(def, current.slug, base);
  await fs.writeFile(current.path, toFile(def, next, typeof notes === "string" ? notes : current.notes));
  return (await getEntity(def, slug))!;
}

/** Move the file to the trash. */
export async function deleteEntity(def: EntityKindDef<any>, slug: string): Promise<void> {
  const root = await requireRoot(def.kind);
  const file = path.join(root, `${safeEntitySlug(def, slug)}.md`);
  if (!(await fs.stat(file).catch(() => null))) throw new Error(`no ${def.singular} "${slug}"`);
  await moveToTrash(def.kind, slug, file);
}

/* ---------- agent context ---------- */

/** One line for an entry in a context block: its token, how it reads, its records. */
export function entityLine<D extends EntityBase>(def: EntityKindDef<D>, d: D): string {
  const url = def.kind === "places" ? (d as unknown as PlaceDef).mapsUrl : (d as unknown as { url?: string }).url;
  return `- ${def.singular}:${d.slug} — ${def.describe(d)}${url ? ` (${url})` : ""}`;
}

/**
 * The "## Contacts, places and events" block every chat starts with when at
 * least one of the kinds is on: what exists (counts, the next events), how
 * to reference an entry, and the CLI that reads and writes them.
 */
export async function entitiesContext(): Promise<string> {
  const views = await Promise.all([listEntities(CONTACTS), listEntities(PLACES), listEntities(EVENTS)]);
  const [contacts, places, events] = views;
  if (!views.some((v) => v.enabled)) return "";
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.items.filter((e) => !e.configError && (e.end ?? e.start).slice(0, 10) >= today).slice(0, 5);
  const kinds = [
    contacts.enabled ? `- contacts (${contacts.items.length}): people and organisations — role, org, email, phone, place, records (CRM, newsletter tool)` : "",
    places.enabled ? `- places (${places.items.length}): addresses and points of interest — address, lat/lng, records (Google Maps); \`places show <slug>\` prints the map link` : "",
    events.enabled ? `- events (${events.items.length}): dated one-off entries — start, end, place, contacts, project, records (calendar entry)` : "",
  ].filter(Boolean);
  return (
    `## Contacts, places and events\n` +
    `The workspace keeps its own records of who, where and when as Markdown files (YAML frontmatter + notes). ` +
    `Reference one anywhere — in notes, a project's files, your replies — as \`contact:<slug>\`, \`place:<slug>\`, \`event:<slug>\` ` +
    `(likewise project:, agent:, workflow:, repo:, vibeable:, knowledge:); kraftwerk resolves the token and marks a missing target.\n` +
    kinds.join("\n") +
    `\n\nRead and write them through the CLI, never by hand:\n` +
    `- \`npx kraftwerk contacts|places|events list --json\` (\`events list --from <date> --to <date>\`), \`… show <slug> --json\`\n` +
    `- \`npx kraftwerk contacts create "<name>" --org … --email … --place <place-slug>\`, \`places create "<name>" --address "…"\`, ` +
    `\`events create "<title>" --start 2026-11-03T14:00 --place <slug> --contacts a,b --project <slug>\`\n` +
    `- \`… set <slug> --<field> <value>\` changes fields (\`--notes-file <md>\` replaces the notes), \`… remove <slug>\` moves the file to the trash, ` +
    `\`npx kraftwerk ref <kind:slug>\` checks a reference.\n` +
    `Fields that point at other entries hold slugs; a target that does not exist yet is allowed and reported as missing.` +
    (upcoming.length ? `\n\nNext events:\n${upcoming.map((e) => entityLine(EVENTS, e)).join("\n")}` : "")
  );
}

export { recordLine };
