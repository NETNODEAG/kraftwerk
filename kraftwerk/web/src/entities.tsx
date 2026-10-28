import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { api, failure, useApi } from "./api";
import { RecordsPanel } from "./projects";
import { linkRefs } from "./refs";
import { fmtAgo, Icon, Link, navigate } from "./shared";
import { Button, Dot, EmptyState, Field, FieldRow, FormStack, ListRow, Notice, Page, PageHeader, Panel, SideHead, SideList, SideNote, SideSearch, Tag, TextArea, TextField } from "./ui";
import type { EntityBase, EntityDetail, EntitiesView, LinkState, SystemOfRecord } from "./types";

/**
 * Contacts, places and events (#/contacts, #/places, #/events): the
 * workspace's records of who, where and when, one Markdown file each
 * (src/core/entities.ts). One screen for the three kinds, configured by
 * the kind's fields: the list beside the open entry, its fields edited in
 * place, references to other entries with their state, the notes as
 * Markdown, the systems of record. Shown only when kraftwerk.yml turns the
 * kind on.
 */

export type EntityKind = "contacts" | "places" | "events";

interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "email" | "url" | "number" | "date" | "ref" | "refs";
  /** For ref/refs: the pages the slugs link to. */
  refKind?: EntityKind | "projects";
  required?: boolean;
  hint: string;
}

interface KindSpec {
  singular: string;
  icon: string;
  /** What the kind holds, for the empty state. */
  what: string;
  /** The same fields as the server's definition, in its order (src/core/entities.ts). */
  fields: FieldSpec[];
  /** The one line under the title in the list. */
  describe(e: Entity): string;
}

/** An entry of any kind: the shared fields plus the kind's own by name. */
type Entity = EntityDetail<EntityBase> & Record<string, unknown>;
type Summary = EntitiesView<EntityBase>["items"][number] & Record<string, unknown>;

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

export const KINDS: Record<EntityKind, KindSpec> = {
  contacts: {
    singular: "contact",
    icon: "person",
    what: "people and organisations the workspace works with",
    fields: [
      { name: "role", label: "role", type: "text", hint: "What they do (CTO, project lead)" },
      { name: "org", label: "organisation", type: "text", hint: "Company or organisation" },
      { name: "email", label: "email", type: "email", hint: "Email address" },
      { name: "phone", label: "phone", type: "text", hint: "Phone number" },
      { name: "place", label: "place", type: "ref", refKind: "places", hint: "Slug of the place they are usually at" },
      { name: "url", label: "website", type: "url", hint: "https://…" },
    ],
    describe: (e) => [str(e.role), str(e.org)].filter(Boolean).join(", "),
  },
  places: {
    singular: "place",
    icon: "location_on",
    what: "addresses and points of interest",
    fields: [
      { name: "address", label: "address", type: "text", hint: "Street, number, postcode, town" },
      { name: "lat", label: "latitude", type: "number", hint: "47.05" },
      { name: "lng", label: "longitude", type: "number", hint: "8.30" },
      { name: "url", label: "website", type: "url", hint: "https://…" },
    ],
    describe: (e) => str(e.address),
  },
  events: {
    singular: "event",
    icon: "event",
    what: "dated, one-off entries — a meeting, a launch, a deadline",
    fields: [
      { name: "start", label: "start", type: "date", required: true, hint: "2026-11-03 or 2026-11-03T14:00" },
      { name: "end", label: "end", type: "date", hint: "not before start" },
      { name: "place", label: "place", type: "ref", refKind: "places", hint: "Slug of the place" },
      { name: "contacts", label: "contacts", type: "refs", refKind: "contacts", hint: "Contact slugs, comma-separated" },
      { name: "project", label: "project", type: "ref", refKind: "projects", hint: "Slug of the project" },
      { name: "url", label: "link", type: "url", hint: "https://…" },
    ],
    describe: (e) => `${str(e.start).replace("T", " ")}${e.end ? `–${str(e.end).replace("T", " ")}` : ""}`,
  },
};

/* ---------- the routes, typed once ---------- */

// The three route families share one shape; the client is typed per kind, so one kind's names stand for all.
type Verb = "list" | "get" | "create" | "save" | "delete";
const name = <V extends Verb>(kind: EntityKind, verb: V) => `${kind}.${verb}` as `contacts.${V}`;
const getEntity = (kind: EntityKind, slug: string) => api.request(name(kind, "get"), { slug });
const saveEntity = (kind: EntityKind, slug: string, body: Record<string, unknown>) => api.request(name(kind, "save"), { slug, body });
const createEntity = (kind: EntityKind, body: Record<string, unknown> & { title: string }) => api.request(name(kind, "create"), { body });
const deleteEntity = (kind: EntityKind, slug: string) => api.request(name(kind, "delete"), { slug });

const today = (): string => new Date().toISOString().slice(0, 10);

/** The list's order: events upcoming first (soonest on top), then the past (latest first); the rest as the server sorts them. */
function ordered(kind: EntityKind, items: Summary[]): Summary[] {
  if (kind !== "events") return items;
  const now = today();
  const upcoming = items.filter((e) => str(e.end || e.start).slice(0, 10) >= now);
  const past = items.filter((e) => str(e.end || e.start).slice(0, 10) < now).reverse();
  return [...upcoming, ...past];
}

export function EntitiesScreen({ kind, slug }: { kind: EntityKind; slug?: string }) {
  const spec = KINDS[kind];
  const data = useApi(name(kind, "list"), {}) as EntitiesView<EntityBase> | null;
  const [q, setQ] = useState("");
  const items = ordered(kind, (data?.items ?? []) as Summary[]);
  const shown = q.trim() ? items.filter((e) => `${e.title} ${e.slug} ${spec.describe(e as Entity)} ${e.tags.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const creating = slug === "new";
  const past = kind === "events" ? new Set(items.filter((e) => str(e.end || e.start).slice(0, 10) < today()).map((e) => e.slug)) : new Set<string>();

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead title={kind} count={data?.items.length} action={<Button size="sm" variant="quiet" icon="add" href={`/${kind}/new`}>new</Button>} />
        {items.length > 6 && <SideSearch value={q} placeholder={`find a ${spec.singular}…`} aria-label={`find a ${spec.singular}`} onChange={(e) => setQ(e.target.value)} />}
        <SideList label={kind}>
          {shown.map((e) => (
            <ListRow
              key={e.slug}
              href={`/${kind}/${encodeURIComponent(e.slug)}`}
              active={e.slug === slug}
              size="sm"
              dim={past.has(e.slug)}
              leading={e.configError ? <Dot tone="bad" title={e.configError} /> : <Icon name={spec.icon} className="ms-sm" />}
              title={e.title}
              sub={e.configError ? "unreadable frontmatter" : spec.describe(e as Entity) || undefined}
            />
          ))}
          {data && !data.enabled && <SideNote>{data.error}</SideNote>}
          {data?.enabled && items.length === 0 && <SideNote>no {kind} yet</SideNote>}
        </SideList>
      </aside>
      <div className="runs-main">
        {slug && !creating ? (
          <EntityPage key={`${kind}/${slug}`} kind={kind} slug={slug} />
        ) : creating ? (
          <NewEntity kind={kind} />
        ) : (
          <EmptyState icon={spec.icon} action={data?.enabled ? <Button variant="primary" icon="add" href={`/${kind}/new`}>new {spec.singular}</Button> : undefined}>
            {data && !data.enabled ? data.error : <>{kind}: {spec.what}. One Markdown file each under the {kind} root; reference one anywhere as <code>{spec.singular}:&lt;slug&gt;</code>.</>}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

/* ---------- one entry ---------- */

/** A field's input: text, number, date and references share one box; the server checks the value. */
function FieldInput({ field, value, onChange, disabled }: { field: FieldSpec; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <TextField
      value={value}
      placeholder={field.hint}
      aria-label={`${field.label}`}
      inputMode={field.type === "number" ? "decimal" : undefined}
      type={field.type === "email" ? "email" : "text"}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The state of a reference field's targets, under its box: each slug as a link, a missing one marked. */
function RefStates({ links, refKind }: { links: LinkState[] | undefined; refKind: FieldSpec["refKind"] }) {
  if (!links?.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <Tag key={l.slug} tone={l.found ? "neutral" : "bad"} title={l.found ? l.label : "not found in this workspace"}>
          {l.found ? (
            <Link href={`/${refKind}/${encodeURIComponent(l.slug)}`} className="text-inherit no-underline hover:underline">
              {l.slug}
            </Link>
          ) : (
            l.slug
          )}
          {!l.found && " · not found"}
        </Tag>
      ))}
    </span>
  );
}

function EntityPage({ kind, slug }: { kind: EntityKind; slug: string }) {
  const spec = KINDS[kind];
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preview, setPreview] = useState(true);

  const apply = (e: Entity) => {
    setEntity(e);
    setTitle(e.title);
    setFields(Object.fromEntries(spec.fields.map((f) => [f.name, Array.isArray(e[f.name]) ? (e[f.name] as string[]).join(", ") : str(e[f.name])])));
    setTags(e.tags.join(", "));
    setNotes(e.notes);
    setDirty(false);
  };

  useEffect(() => {
    let alive = true;
    getEntity(kind, slug).then((r) => {
      if (!alive) return;
      if (r.ok) apply(r.data as Entity);
      else setLoadError(failure(r));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setError("");
  };

  const save = async (body: Record<string, unknown>, opts: { keepEdits?: boolean } = {}) => {
    setSaving(true);
    setError("");
    try {
      const r = await saveEntity(kind, slug, body);
      if (!r.ok) throw new Error(failure(r));
      if (opts.keepEdits) setEntity(r.data as Entity);
      else {
        apply(r.data as Entity);
        // Saved notes show rendered, with their references linked.
        setPreview(true);
      }
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveAll = () =>
    save({
      title,
      tags,
      notes,
      ...Object.fromEntries(spec.fields.map((f) => [f.name, fields[f.name] ?? ""])),
    });

  const remove = async () => {
    const r = await deleteEntity(kind, slug);
    if (!r.ok) return setError(failure(r));
    navigate(`/${kind}`, { replace: true });
  };

  const html = useMemo(() => (notes.trim() ? linkRefs(DOMPurify.sanitize(marked.parse(notes, { async: false }) as string)) : ""), [notes]);

  if (loadError && !entity) {
    return (
      <Page>
        <PageHeader icon={spec.icon} title={slug} />
        <Notice tone="bad">{loadError}</Notice>
      </Page>
    );
  }
  if (!entity) return <EmptyState>loading…</EmptyState>;
  const mapsUrl = kind === "places" ? str(entity.mapsUrl) : "";

  return (
    <Page className={`${spec.singular}-page`}>
      <PageHeader
        icon={spec.icon}
        title={<TextField value={title} aria-label={`${spec.singular} title`} className="h-auto border-0 bg-transparent px-0 text-xl font-semibold shadow-none" onChange={(e) => { setTitle(e.target.value); touch(); }} />}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs">{spec.singular}:{entity.slug}</code>
            {entity.updatedAt && <span>changed {fmtAgo(entity.updatedAt)}</span>}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">
                <Icon name="map" className="ms-sm" /> open in Google Maps
              </a>
            )}
          </span>
        }
        actions={
          <>
            {error && <span className="text-sm text-bad">{error}</span>}
            {saved && !dirty && <span className="text-sm text-fg-2">saved</span>}
            <Button variant="primary" icon="save" busy={saving} disabled={!dirty || saving || !title.trim()} onClick={() => void saveAll()}>
              save
            </Button>
            {confirmRemove ? (
              <>
                <Button variant="danger" onClick={() => void remove()}>move to trash</Button>
                <Button variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
              </>
            ) : (
              <Button variant="quiet" icon="delete" title="move to the trash" onClick={() => setConfirmRemove(true)}>
                remove
              </Button>
            )}
          </>
        }
      />
      {entity.configError && <Notice tone="bad">frontmatter: {entity.configError} — the fields below show defaults and cannot be saved; fix the file by hand first.</Notice>}

      <Panel title="fields" className="flex-none">
        <FormStack className="max-w-[760px]">
          {spec.fields.map((f) => (
            <Field key={f.name} label={`${f.label}${f.required ? " *" : ""}`} hint={f.type === "ref" || f.type === "refs" ? <RefStates links={entity.links[f.name]} refKind={f.refKind} /> : undefined}>
              <FieldInput field={f} value={fields[f.name] ?? ""} onChange={(v) => { setFields((x) => ({ ...x, [f.name]: v })); touch(); }} />
            </Field>
          ))}
          <FieldRow>
            <Field label="tags" className="flex-1">
              <TextField value={tags} placeholder="comma-separated" aria-label="tags" onChange={(e) => { setTags(e.target.value); touch(); }} />
            </Field>
          </FieldRow>
          {entity.extra && Object.keys(entity.extra).length > 0 && (
            <div className="text-xs text-fg-2">
              Also in the file, kept as written: {Object.entries(entity.extra).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}
            </div>
          )}
        </FormStack>
      </Panel>

      <Panel
        title="notes"
        className="flex-none"
        actions={
          <Button size="sm" variant="quiet" icon={preview ? "edit" : "visibility"} onClick={() => setPreview((p) => !p)}>
            {preview ? "edit" : "preview"}
          </Button>
        }
      >
        {preview ? (
          html ? (
            <div className="md-body px-[18px] py-3" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="px-[18px] py-3 text-xs text-fg-2">no notes yet — Markdown; reference other entries as contact:&lt;slug&gt;, place:&lt;slug&gt;, event:&lt;slug&gt;</div>
          )
        ) : (
          <FormStack>
            <TextArea value={notes} aria-label="notes" rows={10} className="font-mono text-[13px]" placeholder="Markdown notes" onChange={(e) => { setNotes(e.target.value); touch(); }} />
          </FormStack>
        )}
      </Panel>

      <RecordsPanel records={entity.records as SystemOfRecord[]} saving={saving} onSave={(records) => save({ records }, { keepEdits: true })} />
    </Page>
  );
}

/* ---------- a new entry ---------- */

function NewEntity({ kind }: { kind: EntityKind }) {
  const spec = KINDS[kind];
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await createEntity(kind, { title, ...fields });
      if (!r.ok) throw new Error(failure(r));
      navigate(`/${kind}/${encodeURIComponent((r.data as Entity).slug)}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader icon={spec.icon} title={`new ${spec.singular}`} sub={`a Markdown file under the ${kind} root; the file name derives from the title`} />
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void create();
          }}
        >
          <FormStack className="max-w-[680px]">
            <Field label="title">
              <TextField value={title} aria-label={`${spec.singular} title`} autoFocus placeholder={kind === "contacts" ? "e.g. Anna Meier" : kind === "places" ? "e.g. NETNODE Office" : "e.g. Kickoff"} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {spec.fields.map((f) => (
              <Field key={f.name} label={`${f.label}${f.required ? " *" : ""}`}>
                <FieldInput field={f} value={fields[f.name] ?? ""} onChange={(v) => setFields((x) => ({ ...x, [f.name]: v }))} />
              </Field>
            ))}
            <FieldRow>
              <Button variant="primary" type="submit" icon="add" busy={busy} disabled={!title.trim() || busy}>
                create {spec.singular}
              </Button>
              <Button variant="quiet" href={`/${kind}`}>cancel</Button>
              {error && <span className="text-sm text-bad">{error}</span>}
            </FieldRow>
          </FormStack>
        </form>
      </Panel>
    </Page>
  );
}
