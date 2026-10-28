/**
 * References in rendered text: `contact:anna-meier`, `place:…`, `event:…`,
 * `project:…`, `agent:…`, `workflow:…`, `repo:…`, `vibeable:…`,
 * `knowledge:…` become links to the thing's page. The same token rule as
 * the server's registry (src/core/refs.ts): only these tokens, followed by
 * a slug, not inside a word, a path or a URL — so `https:` never matches.
 * The page says whether the target exists; nothing is resolved here.
 */

/** Token → the hash route of the kind's pages. */
export const REF_ROUTES: Record<string, string> = {
  knowledge: "knowledge",
  vibeable: "vibeables",
  repo: "repos",
  workflow: "workflows",
  agent: "agents",
  project: "projects",
  contact: "contacts",
  place: "places",
  event: "events",
};

export const REF_TOKEN_RE = new RegExp(`(?<![\\w/:.@-])(${Object.keys(REF_ROUTES).join("|")}):([a-z0-9][a-z0-9-]{0,48})(?![\\w-])`, "g");

/** The hash href of a token ("contact:anna-meier" → "#/contacts/anna-meier"). */
export const refHref = (token: string): string => {
  const [kind, slug] = token.split(":");
  return `#/${REF_ROUTES[kind]}/${encodeURIComponent(slug)}`;
};

const REF_CLASS = "md-ref rounded-[5px] bg-surface-2 px-1 py-px font-mono text-[0.9em] text-accent no-underline hover:underline";

/** Rendered (sanitized) HTML with every reference in its text linked; links, code and preformatted text are left alone. */
export function linkRefs(html: string): string {
  if (!REF_TOKEN_RE.test(html)) return html;
  REF_TOKEN_RE.lastIndex = 0;
  const box = document.createElement("template");
  box.innerHTML = html;
  const walker = document.createTreeWalker(box.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const text of texts) {
    if (text.parentElement?.closest("a, code, pre")) continue;
    const value = text.data;
    REF_TOKEN_RE.lastIndex = 0;
    if (!REF_TOKEN_RE.test(value)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    REF_TOKEN_RE.lastIndex = 0;
    for (const m of value.matchAll(REF_TOKEN_RE)) {
      frag.append(value.slice(last, m.index));
      const a = document.createElement("a");
      a.className = REF_CLASS;
      a.href = refHref(m[0]);
      a.textContent = m[0];
      frag.append(a);
      last = m.index + m[0].length;
    }
    frag.append(value.slice(last));
    text.replaceWith(frag);
  }
  return box.innerHTML;
}
