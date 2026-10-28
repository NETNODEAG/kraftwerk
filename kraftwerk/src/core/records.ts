/**
 * Systems of record: where the truth of something is managed outside
 * kraftwerk — a tool, a folder, a board. A project points at its ticket
 * system, a contact at the CRM and the newsletter tool, an event at its
 * calendar entry, a place at Google Maps. An entry is context, not a
 * credential and not a grant: it says where the truth lives and how it is
 * usually reached, and the harness decides what the agent may call.
 */

export interface SystemOfRecord {
  /** my-netnode | google-drive | github | bitbucket | notion | slack | crm | newsletter | calendar | google-maps | url | anything else (rendered by name). */
  kind: string;
  /** Display name ("Figma board", "Contracts folder"). */
  title?: string;
  url?: string;
  /** For tools with workspaces or boards: the id the agent needs (a my.netnode.ch workspace, a Slack channel). */
  workspace?: string;
  /** What lives there and how it is usually reached ("tickets and roadmap, `my` CLI"). */
  note?: string;
}

/** What kraftwerk knows about a record kind: a label and what such a place usually holds. */
export const RECORD_KINDS: Record<string, { label: string; hint: string }> = {
  "my-netnode": { label: "my.netnode.ch", hint: "tickets, roadmap items, meetings and workspace memory" },
  "google-drive": { label: "Google Drive", hint: "documents and folders" },
  github: { label: "GitHub", hint: "issues, pull requests and discussions" },
  bitbucket: { label: "Bitbucket", hint: "pull requests and pipelines" },
  notion: { label: "Notion", hint: "pages and databases" },
  slack: { label: "Slack", hint: "conversations and decisions" },
  crm: { label: "CRM", hint: "the contact's record, deals and history" },
  newsletter: { label: "Newsletter tool", hint: "subscription and mailing lists" },
  calendar: { label: "Calendar", hint: "the calendar entry, invitees and reminders" },
  "google-maps": { label: "Google Maps", hint: "the place on the map, opening hours and directions" },
  url: { label: "Link", hint: "" },
};

/** Any input -> a clean list of records; every problem is one error the caller can show. */
export const cleanRecords = (v: unknown): SystemOfRecord[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error("records must be a list");
  return v.map((r, i) => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw new Error(`records[${i}] must be a mapping (kind, title, url, workspace, note)`);
    const o = r as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind.trim().toLowerCase() : "";
    if (!kind) throw new Error(`records[${i}]: kind is required (e.g. my-netnode, google-drive, url)`);
    const str = (k: string): string | undefined => {
      const x = o[k];
      if (x === undefined || x === null || x === "") return undefined;
      if (typeof x === "number") return String(x);
      if (typeof x !== "string") throw new Error(`records[${i}].${k} must be a string`);
      return x.trim() || undefined;
    };
    const url = str("url");
    if (url && !/^https?:\/\//.test(url)) throw new Error(`records[${i}].url must start with http:// or https://`);
    const out: SystemOfRecord = { kind };
    const title = str("title");
    const workspace = str("workspace");
    const note = str("note");
    if (title) out.title = title;
    if (url) out.url = url;
    if (workspace) out.workspace = workspace;
    if (note) out.note = note;
    return out;
  });
};

/** One line per system of record: what it is, where, and what usually lives there. */
export function recordLine(r: SystemOfRecord): string {
  const known = RECORD_KINDS[r.kind];
  const label = known?.label ?? r.kind;
  const head = r.title ? `${label}: ${r.title}` : label;
  const parts = [r.workspace ? `workspace ${r.workspace}` : "", r.url ?? "", known?.hint ?? "", r.note ?? ""].filter(Boolean);
  return `- ${head}${parts.length ? ` — ${parts.join("; ")}` : ""}`;
}
