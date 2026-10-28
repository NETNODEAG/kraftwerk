import { listAgents } from "./agents.js";
import { CONTACTS, EVENTS, listEntities, PLACES } from "./entities.js";
import { knowledgeIndex } from "./knowledge.js";
import { listProjects } from "./projects.js";
import { listRepos } from "./repos.js";
import { listVibeables } from "./vibeables.js";
import { listWorkflows } from "./workflows.js";

/**
 * The reference registry: everything in a workspace that can be pointed
 * at by name — knowledge bundles, vibeables, repositories, workflows,
 * agents, projects, contacts, places and events. Each kind registers only
 * a lookup (its storage and routes stay where they are); one resolver then
 * serves every place a reference appears: a project's link lists, an
 * event's place and contacts, a `contact:anna-meier` token in text, the
 * ⌘K palette and the context an agent starts with.
 *
 * A reference is `<token>:<slug>` — the kind's singular token (contact,
 * place, event, project, agent, workflow, repo, vibeable, knowledge) and
 * the target's slug. Only registered tokens match, so `https:` and the
 * like never do. A target that does not exist is reported (found: false),
 * never an error — the same rule project links have always followed.
 */

export const REF_KIND_NAMES = ["knowledge", "vibeables", "repos", "workflows", "agents", "projects", "contacts", "places", "events"] as const;
/** The kind's plural: the link-list name in project.yml and the folder/route name. */
export type RefKind = (typeof REF_KIND_NAMES)[number];

/** One existing target. */
export interface RefTarget {
  slug: string;
  /** Display text next to the slug (an agent's name, a bundle's size); "" when there is nothing to add. */
  label: string;
  /** Where the web UI opens it (a hash route). */
  href: string;
}

export interface RefKindDef {
  kind: RefKind;
  /** The token in text: contact in contact:anna-meier. */
  token: string;
  /** How the kind reads in a sentence ("knowledge bundle", "contact"). */
  noun: string;
  /** Every target that exists right now; [] when the feature is off. */
  list(): Promise<RefTarget[]>;
}

/** One referenced slug and whether its target exists right now. */
export interface LinkState {
  slug: string;
  found: boolean;
  /** Display name of the target when found (an agent's name, a workflow's description). */
  label?: string;
}

/** A `kind:slug` token, resolved. */
export interface ResolvedRef extends LinkState {
  kind: RefKind;
  token: string;
  href: string;
}

/** A list that fails to read is an empty list: a reference into it is "not found", never an error. */
const safe = async <T, F>(p: Promise<T>, fallback: F): Promise<T | F> => p.catch(() => fallback);

export const REF_KINDS: readonly RefKindDef[] = [
  {
    kind: "knowledge",
    token: "knowledge",
    noun: "knowledge bundle",
    list: async () => (await safe(knowledgeIndex(), { bundles: [] })).bundles.map((b) => ({ slug: b.name, label: `${b.concepts} concepts`, href: `/knowledge/${b.name}` })),
  },
  {
    kind: "vibeables",
    token: "vibeable",
    noun: "vibeable",
    list: async () => (await safe(listVibeables(), { vibeables: [] })).vibeables.map((v) => ({ slug: v.slug, label: v.dev ? "dev" : "static", href: `/vibeables/${v.slug}` })),
  },
  {
    kind: "repos",
    token: "repo",
    noun: "repository",
    list: async () => (await safe(listRepos(), { repos: [] })).repos.map((r) => ({ slug: r.slug, label: r.branch ?? "", href: `/repos/${r.slug}` })),
  },
  {
    kind: "workflows",
    token: "workflow",
    noun: "workflow",
    list: async () => (await safe(listWorkflows(), { workflows: [] })).workflows.map((w) => ({ slug: w.slug, label: w.description ?? w.name ?? "", href: `/workflows/${w.slug}` })),
  },
  {
    kind: "agents",
    token: "agent",
    noun: "agent",
    list: async () =>
      (await safe(listAgents(), []))
        .filter((a) => !a.archived)
        .map((a) => ({ slug: a.slug, label: `${a.emoji} ${a.name}`, href: `/agents/${a.slug}` })),
  },
  {
    kind: "projects",
    token: "project",
    noun: "project",
    list: async () => (await safe(listProjects(), { projects: [] })).projects.map((p) => ({ slug: p.slug, label: p.title, href: `/projects/${p.slug}` })),
  },
  {
    kind: "contacts",
    token: "contact",
    noun: "contact",
    list: async () => (await safe(listEntities(CONTACTS), { items: [] })).items.map((c) => ({ slug: c.slug, label: CONTACTS.describe(c), href: `/contacts/${c.slug}` })),
  },
  {
    kind: "places",
    token: "place",
    noun: "place",
    list: async () => (await safe(listEntities(PLACES), { items: [] })).items.map((p) => ({ slug: p.slug, label: PLACES.describe(p), href: `/places/${p.slug}` })),
  },
  {
    kind: "events",
    token: "event",
    noun: "event",
    list: async () => (await safe(listEntities(EVENTS), { items: [] })).items.map((e) => ({ slug: e.slug, label: EVENTS.describe(e), href: `/events/${e.slug}` })),
  },
];

const byKind = new Map(REF_KINDS.map((d) => [d.kind, d]));
const byToken = new Map(REF_KINDS.map((d) => [d.token, d]));

/** The kind registered under a plural name or a token; undefined for anything else. */
export const refKind = (name: string): RefKindDef | undefined => byKind.get(name as RefKind) ?? byToken.get(name);

/** The link states of some slugs against one list of targets. */
const states = (slugs: string[], targets: RefTarget[]): LinkState[] =>
  slugs.map((slug) => {
    const t = targets.find((x) => x.slug === slug);
    return t ? { slug, found: true, ...(t.label ? { label: t.label } : {}) } : { slug, found: false };
  });

/** Which of the slugs exist right now, per kind. Kinds without slugs are not listed at all. */
export async function resolveRefs<K extends RefKind>(byKind: Record<K, string[]>): Promise<Record<K, LinkState[]>> {
  const out = {} as Record<K, LinkState[]>;
  await Promise.all(
    (Object.keys(byKind) as K[]).map(async (kind) => {
      const slugs = byKind[kind];
      const def = refKind(kind);
      out[kind] = !def || slugs.length === 0 ? [] : states(slugs, await def.list());
    }),
  );
  return out;
}

const SLUG = "[a-z0-9][a-z0-9-]{0,48}";
/** A `token:slug` reference in text: a registered token, a colon, a slug — not inside a word, a path or a URL. */
export const REF_TOKEN_RE = new RegExp(`(?<![\\w/:.@-])(${REF_KINDS.map((d) => d.token).join("|")}):(${SLUG})(?![\\w-])`, "g");

/** Every distinct reference in a text, in order of appearance. */
export function findRefs(text: string): Array<{ token: string; kind: RefKind; slug: string }> {
  const seen = new Set<string>();
  const out: Array<{ token: string; kind: RefKind; slug: string }> = [];
  for (const m of text.matchAll(REF_TOKEN_RE)) {
    const token = m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ token, kind: byToken.get(m[1])!.kind, slug: m[2] });
  }
  return out;
}

/** Parse one reference ("contact:anna-meier"); null when it is not one. */
export function parseRef(text: string): { token: string; kind: RefKind; slug: string } | null {
  const m = new RegExp(`^(${REF_KINDS.map((d) => d.token).join("|")}|${REF_KIND_NAMES.join("|")}):(${SLUG})$`).exec(text.trim());
  if (!m) return null;
  const def = refKind(m[1])!;
  return { token: `${def.token}:${m[2]}`, kind: def.kind, slug: m[2] };
}

/** Resolve references: each with whether its target exists and where it opens. */
export async function resolveTokens(refs: Array<{ kind: RefKind; slug: string }>): Promise<ResolvedRef[]> {
  const kinds = [...new Set(refs.map((r) => r.kind))];
  const lists = new Map(await Promise.all(kinds.map(async (k) => [k, await refKind(k)!.list()] as const)));
  return refs.map((r) => {
    const def = refKind(r.kind)!;
    const t = lists.get(r.kind)!.find((x) => x.slug === r.slug);
    return { kind: r.kind, token: `${def.token}:${r.slug}`, slug: r.slug, found: !!t, ...(t?.label ? { label: t.label } : {}), href: t?.href ?? `/${r.kind}/${r.slug}` };
  });
}

/** Resolve one reference written as text; null when the text is not a reference. */
export async function resolveRef(text: string): Promise<ResolvedRef | null> {
  const ref = parseRef(text);
  if (!ref) return null;
  return (await resolveTokens([ref]))[0];
}
