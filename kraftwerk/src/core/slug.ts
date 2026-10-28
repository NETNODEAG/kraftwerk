/**
 * The one slug rule for folders and files kraftwerk names after a title:
 * lowercase letters, digits and dashes, at most 49 characters, starting
 * with a letter or digit. Projects, contacts, places and events share it,
 * so a `kind:slug` reference has one shape everywhere.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** Derive a slug from a title: "Relaunch netnode.ch" -> "relaunch-netnode-ch". */
export function slugify(title: string, max = 48): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}
