import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, failure } from "./api";
import { Icon, fmtAgo, fmtSize, navigate } from "./shared";
import { Button, cn, EmptyState, IconButton, ListRow, Notice, SideHead, SideList, TextField } from "./ui";
import type { FileEntry, FilesListing, FilesScopeInfo } from "./types";

/**
 * Files (#/files): the material of the work, any format, as plain folders.
 * The workspace's own files plus one root per project (its files/ folder).
 * A folder tree on the left, the folder in the middle, the selected file
 * previewed on the right. Drop files anywhere on the list to upload;
 * delete goes to the trash. The same browser, compact, is the "files" tab
 * of a project's context column.
 *
 * Routes: #/files/<scope>/<folder path>[?file=<path>] — scope is
 * "workspace" or "project:<slug>".
 */

const raw = (scope: string, p: string, download = false) => api.url("files.raw", { query: { scope, path: p, download } });

export const filesHref = (scope: string, dir = "", file?: string) =>
  `/files/${encodeURIComponent(scope)}${dir ? `/${dir.split("/").map(encodeURIComponent).join("/")}` : ""}${file ? `?file=${encodeURIComponent(file)}` : ""}`;

const LINK_ICON = "inline-grid size-7 shrink-0 place-items-center rounded-control text-fg-2 no-underline hover:bg-surface-2 hover:text-fg";
const CELL = "whitespace-nowrap border-b border-line px-2.5 py-1.5 text-left";

/** One step of the folder path; the last one is where you are. */
function Crumb({ here, onClick, children }: { here: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("cursor-pointer rounded-md border-0 bg-transparent px-1 py-0.5 font-[inherit] hover:bg-surface-2 hover:text-fg", here ? "font-semibold text-fg" : "text-fg-2")}
    >
      {children}
    </button>
  );
}

function iconOf(e: FileEntry): string {
  if (e.type === "dir") return "folder";
  const m = e.mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "picture_as_pdf";
  if (m.startsWith("video/")) return "movie";
  if (m.startsWith("audio/")) return "music_note";
  if (/csv|tab-separated|spreadsheet/.test(m)) return "table";
  if (/zip/.test(m)) return "folder_zip";
  if (/presentation/.test(m)) return "slideshow";
  if (m.startsWith("text/") || /json|yaml|xml|wordprocessing/.test(m)) return "description";
  return "draft";
}

export function FilesScreen({ scope, dir, file }: { scope: string; dir: string; file?: string }) {
  const [scopes, setScopes] = useState<FilesScopeInfo[] | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    api.call("files.scopes").then(
      (d) => setScopes(d.scopes),
      () => setScopes([])
    );
  }, [rev]);
  const projects = (scopes ?? []).filter((s) => s.scope !== "workspace");
  return (
    <div className="runs-screen files-screen">
      <aside className="runs-side">
        <SideHead title="files" />
        <SideList>
          {(scopes ?? []).filter((s) => s.scope === "workspace").map((s) => (
            <ScopeRow key={s.scope} s={s} active={scope === s.scope} icon="home_storage" />
          ))}
          {projects.length > 0 && <SideHead title="projects" divided />}
          {projects.map((s) => (
            <ScopeRow key={s.scope} s={s} active={scope === s.scope} icon="folder_special" />
          ))}
        </SideList>
      </aside>
      <div className="runs-main min-w-0">
        <FileBrowser
          key={scope}
          scope={scope}
          dir={dir}
          file={file}
          onOpen={(d, f) => navigate(filesHref(scope, d, f))}
          onChanged={() => setRev((n) => n + 1)}
        />
      </div>
    </div>
  );
}

function ScopeRow({ s, active, icon }: { s: FilesScopeInfo; active: boolean; icon: string }) {
  return (
    <ListRow
      href={filesHref(s.scope)}
      active={active}
      size="sm"
      leading={<Icon name={icon} className="ms-sm" />}
      title={s.label}
      sub={<span className="font-mono">{s.root}/</span>}
      meta={s.count}
    />
  );
}

/**
 * One root's folder with its files: breadcrumb, new folder, upload (button
 * or drop), the list, and the selected file's preview. `compact` is the
 * context column: the preview replaces the list instead of sitting beside it.
 */
export function FileBrowser({
  scope,
  dir,
  file,
  onOpen,
  onChanged,
  compact = false,
}: {
  scope: string;
  dir: string;
  file?: string;
  onOpen: (dir: string, file?: string) => void;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [listing, setListing] = useState<FilesListing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api.request("files.list", { query: { scope, path: dir } }).catch(() => null);
    const d = r?.data && typeof r.data === "object" ? (r.data as FilesListing & { error?: string }) : null;
    if (!r?.ok || !d || d.error) {
      setError(d?.error ?? "could not load the folder");
      setListing(null);
      return;
    }
    setError("");
    setListing(d);
  }, [scope, dir]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const changed = async () => {
    await load();
    onChanged?.();
  };

  async function uploadAll(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setError("");
    for (const [i, f] of list.entries()) {
      setBusy(list.length > 1 ? `uploading ${i + 1} of ${list.length}…` : `uploading ${f.name}…`);
      const r = await api
        .request("files.upload", {
          query: { scope, path: dir },
          headers: { "x-file-name": encodeURIComponent(f.name), "content-type": f.type || "application/octet-stream" },
          body: f,
        })
        .catch(() => null);
      if (!r?.ok) setError((r?.data as { error?: string } | undefined)?.error ?? `could not upload ${f.name}`);
    }
    setBusy("");
    await changed();
  }

  async function makeFolder(name: string) {
    const n = name.trim();
    setNewFolder(null);
    if (!n) return;
    const error = failure(await api.request("files.mkdir", { body: { scope, path: dir ? `${dir}/${n}` : n } }));
    if (error) setError(error);
    await changed();
  }

  async function rename(from: string, name: string) {
    setRenaming(null);
    const n = name.trim();
    if (!n || n === from.split("/").pop()) return;
    const to = from.includes("/") ? `${from.slice(0, from.lastIndexOf("/"))}/${n}` : n;
    const error = failure(await api.request("files.move", { body: { scope, from, to } }));
    if (error) setError(error);
    else if (file === from) onOpen(dir, to);
    await changed();
  }

  async function remove(p: string) {
    setConfirmDelete(null);
    const r = await api.request("files.delete", { query: { scope, path: p } }).catch(() => null);
    if (!r?.ok) setError((r?.data as { error?: string } | undefined)?.error ?? "could not delete");
    if (file === p) onOpen(dir);
    await changed();
  }

  const crumbs = dir ? dir.split("/") : [];
  const selected = file ? listing?.entries.find((e) => e.path === file) : undefined;
  const showList = !(compact && file);

  return (
    <div
      className={cn(
        "files-browser h-full min-h-0",
        compact ? "flex flex-col gap-2 px-1.5 py-1" : cn("grid gap-4", file ? "grid-cols-1 min-[900px]:grid-cols-[minmax(280px,1fr)_minmax(0,1.3fr)]" : "grid-cols-1")
      )}
    >
      {showList && (
        <div
          className={cn(
            "flex min-h-0 flex-col rounded-card outline-2 -outline-offset-2 outline-dashed transition-colors",
            drag ? "bg-accent/5 outline-accent" : "outline-transparent"
          )}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes("Files")) return;
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void uploadAll(e.dataTransfer.files);
          }}
        >
          <div className={cn("flex items-center gap-1", compact ? "px-1 pb-1.5 pt-0.5" : "px-0.5 pb-2.5 pt-1")}>
            <nav className={cn("flex min-w-0 flex-wrap items-center", compact ? "text-sm" : "text-md")} aria-label="Folder">
              <Crumb here={!crumbs.length} onClick={() => onOpen("")}>
                {listing?.label ?? (scope === "workspace" ? "Workspace" : scope.replace(/^project:/, ""))}
              </Crumb>
              {crumbs.map((c, i) => (
                <span key={i} className="inline-flex items-center text-fg-2">
                  <Icon name="chevron_right" className="ms-sm" />
                  <Crumb here={i === crumbs.length - 1} onClick={() => onOpen(crumbs.slice(0, i + 1).join("/"))}>
                    {c}
                  </Crumb>
                </span>
              ))}
            </nav>
            <span className="flex-1" />
            {compact ? (
              <>
                <IconButton icon="create_new_folder" label="New folder" size="sm" onClick={() => setNewFolder("")} />
                <IconButton icon="upload" label="Upload files" size="sm" onClick={() => input.current?.click()} />
              </>
            ) : (
              <>
                <Button variant="quiet" size="sm" icon="create_new_folder" onClick={() => setNewFolder("")} title="New folder">folder</Button>
                <Button variant="quiet" size="sm" icon="upload" onClick={() => input.current?.click()} title="Upload files">upload</Button>
              </>
            )}
            <input ref={input} type="file" multiple hidden aria-label="Upload files" onChange={(e) => e.target.files && void uploadAll(e.target.files)} />
          </div>
          {busy && <Notice>{busy}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="files-list flex min-h-0 flex-1 flex-col gap-px overflow-y-auto" role="list">
            {newFolder !== null && (
              <div className="flex items-center gap-2.5 px-2.5 py-1">
                <Icon name="create_new_folder" className="text-[20px] text-fg-2" />
                <TextField
                  className="h-8"
                  autoFocus
                  value={newFolder}
                  placeholder="folder name"
                  aria-label="Folder name"
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void makeFolder(newFolder);
                    if (e.key === "Escape") setNewFolder(null);
                  }}
                  onBlur={() => void makeFolder(newFolder)}
                />
              </div>
            )}
            {listing?.entries.map((e) =>
              renaming?.path === e.path ? (
                <div key={e.path} role="listitem" className="flex items-center gap-2.5 px-2.5 py-1">
                  <Icon name={iconOf(e)} className="text-[20px] text-fg-2" />
                  <TextField
                    className="h-8"
                    autoFocus
                    value={renaming.name}
                    aria-label="New name"
                    onChange={(ev) => setRenaming({ path: e.path, name: ev.target.value })}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") void rename(e.path, renaming.name);
                      if (ev.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => void rename(e.path, renaming.name)}
                  />
                </div>
              ) : (
                <div key={e.path} role="listitem">
                  <ListRow
                    className="files-row"
                    active={e.path === file}
                    onClick={() => (e.type === "dir" ? onOpen(e.path) : onOpen(dir, e.path))}
                    label={e.name}
                    leading={<Icon name={iconOf(e)} className="text-[20px] text-fg-2" />}
                    title={<span className="font-normal">{e.name}</span>}
                    titleExtra={e.local ? <span className="text-xs font-normal text-fg-2" title="Over 25 MB: kept out of git, stays on this machine">local only</span> : undefined}
                    meta={
                      <>
                        {e.type === "dir" ? `${e.count ?? 0} file${e.count === 1 ? "" : "s"}` : fmtSize(e.size ?? 0)}
                        {!compact && ` · ${fmtAgo(e.modifiedAt)}`}
                      </>
                    }
                    actions={
                      <>
                        {e.type === "file" && (
                          <a className="inline-grid size-7 place-items-center rounded-control text-fg-2 no-underline hover:bg-surface-2 hover:text-fg" href={raw(scope, e.path, true)} title="Download" aria-label={`Download ${e.name}`}>
                            <Icon name="download" className="ms-sm" />
                          </a>
                        )}
                        <IconButton icon="edit" size="sm" label={`Rename ${e.name}`} onClick={() => setRenaming({ path: e.path, name: e.name })} />
                        {confirmDelete === e.path ? (
                          <Button variant="danger" size="sm" autoFocus onClick={() => void remove(e.path)} onBlur={() => setConfirmDelete(null)}>
                            move to trash
                          </Button>
                        ) : (
                          <IconButton icon="delete" size="sm" label={`Delete ${e.name}`} onClick={() => setConfirmDelete(e.path)} />
                        )}
                      </>
                    }
                  />
                </div>
              )
            )}
            {listing && listing.entries.length === 0 && newFolder === null && (
              <EmptyState icon="upload_file" action={<span className="font-mono text-2xs opacity-80">{listing.root}/{dir ? `${dir}/` : ""}</span>}>
                Drop files here, or{" "}
                <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-accent underline" onClick={() => input.current?.click()}>
                  choose some
                </button>
                .
              </EmptyState>
            )}
            {!listing && !error && <EmptyState>loading…</EmptyState>}
          </div>
        </div>
      )}
      {file && (
        <FilePreview
          scope={scope}
          path={file}
          entry={selected}
          onClose={() => onOpen(dir)}
          compact={compact}
        />
      )}
    </div>
  );
}

/** What a file looks like: images, PDFs, media and text inline; anything else as a download. */
function FilePreview({ scope, path: p, entry, onClose, compact }: { scope: string; path: string; entry?: FileEntry; onClose: () => void; compact: boolean }) {
  const mime = entry?.mime ?? "";
  const name = p.split("/").pop() ?? p;
  const src = raw(scope, p);
  const isText = /^text\/|json|yaml|xml/.test(mime) && !/html/.test(mime);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!isText || (entry?.size ?? 0) > 2_000_000) return;
    let alive = true;
    fetch(src, { cache: "no-store" })
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, isText, entry?.size]);

  let body: React.ReactNode;
  if (!entry) body = <EmptyState>loading…</EmptyState>;
  else if (mime.startsWith("image/")) body = <img className="m-auto max-h-full max-w-full flex-none object-contain p-4" src={src} alt={name} />;
  else if (mime === "application/pdf") body = <iframe className={cn("w-full border-0 bg-white", compact ? "min-h-[60vh]" : "min-h-[70vh]")} src={src} title={name} />;
  else if (mime.startsWith("video/")) body = <video className="m-auto max-h-full w-full p-4" src={src} controls />;
  else if (mime.startsWith("audio/")) body = <audio className="m-auto w-full p-4" src={src} controls />;
  else if (isText && text !== null) {
    if (/markdown/.test(mime)) body = <div className="md-body files-md px-5 py-4" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(text, { async: false }) as string) }} />;
    else if (/csv|tab-separated/.test(mime)) body = <CsvTable text={text} tab={/tab-separated/.test(mime)} />;
    else body = <pre className="files-text m-0 whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{text}</pre>;
  } else if (isText && (entry.size ?? 0) <= 2_000_000) body = <EmptyState>loading…</EmptyState>;
  else
    body = (
      <EmptyState icon={iconOf(entry)} action={<Button variant="primary" size="sm" icon="download" href={undefined} onClick={() => (window.location.href = raw(scope, p, true))}>download</Button>}>
        No preview for this kind of file.
      </EmptyState>
    );

  return (
    <section className={cn("files-preview flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface", compact && "min-h-[60vh]")} aria-label={`Preview of ${name}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        {compact && <IconButton icon="arrow_back" label="Back to the folder" size="sm" onClick={onClose} />}
        <span className="min-w-0 truncate text-base font-semibold" title={p}>{name}</span>
        {entry?.size !== undefined && <span className="shrink-0 text-xs tabular-nums text-fg-2">{fmtSize(entry.size)}</span>}
        <span className="flex-1" />
        <a className={LINK_ICON} href={src} target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab"><Icon name="open_in_new" className="ms-sm" /></a>
        <a className={LINK_ICON} href={raw(scope, p, true)} title="Download" aria-label="Download"><Icon name="download" className="ms-sm" /></a>
        {!compact && <IconButton icon="close" label="Close the preview" size="sm" onClick={onClose} />}
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto [&>*]:flex-1">{body}</div>
    </section>
  );
}

/** A CSV (or TSV) as a table: simple quoting, the first 500 rows. */
function CsvTable({ text, tab }: { text: string; tab: boolean }) {
  const sep = tab ? "\t" : text.split("\n")[0].includes(";") && !text.split("\n")[0].includes(",") ? ";" : ",";
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/).slice(0, 501)) {
    if (!line) continue;
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q && ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = !q;
      else if (ch === sep && !q) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...rest] = rows;
  return (
    <div className="overflow-auto">
      <table className="border-collapse text-[12.5px]">
        {head && <thead><tr>{head.map((c, i) => <th key={i} className={cn(CELL, "sticky top-0 bg-surface font-semibold")}>{c}</th>)}</tr></thead>}
        <tbody>{rest.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={CELL}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
