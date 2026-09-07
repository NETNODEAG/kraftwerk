#!/usr/bin/env bash
# Phase "render changelog": changelog.json + commits.json -> changelog.html.
# Fully deterministic; every slot computed here.
set -u

TEMPLATE="$WORKFLOW_DIR/templates/report.html" python3 <<'PY'
import json, os, re, html, datetime

run_dir = os.environ["RUN_DIR"]
cl = json.load(open(os.path.join(run_dir, "changelog.json")))
co = json.load(open(os.path.join(run_dir, "commits.json")))
tpl = open(os.environ["TEMPLATE"], errors="replace").read()
tpl = re.sub(r"<!--\s*\n?\s*SLOT DOCUMENTATION.*?-->\n?", "", tpl, flags=re.S)

def esc(s):
    # slots_filled fails on any literal "{{" — escape it in content.
    return html.escape(str(s)).replace("{{", "&#123;&#123;")

TYPES = ["breaking", "feature", "improvement", "fix", "docs", "internal"]

# ---- highlights ------------------------------------------------------------
highlights = [h for h in cl.get("highlights", []) if str(h).strip()]
hl_html = ""
if highlights:
    items = "".join(f"<li>{esc(h)}</li>" for h in highlights)
    hl_html = ('<h3 class="sect">Highlights</h3>'
               f'<section class="card highlights"><ul>{items}</ul></section>')

# ---- section blocks --------------------------------------------------------
sections = sorted(cl.get("sections", []),
                  key=lambda s: TYPES.index(s.get("type")) if s.get("type") in TYPES else 9)
blocks, entries_total = [], 0
for sec in sections:
    entries = sec.get("entries", [])
    if not entries:
        continue
    typ = sec.get("type", "internal")
    if typ not in TYPES:
        typ = "internal"
    blocks.append(f'<h3 class="sect">{esc(sec.get("title", typ.title()))}</h3>')
    for e in entries:
        entries_total += 1
        chips = "".join(f'<span class="chip">{esc(c)}</span>'
                        for c in e.get("commits", []))
        breaking = ('<span class="badge breaking">breaking</span>'
                    if e.get("breaking") and typ != "breaking" else "")
        blocks.append(
            f'<section class="card entry {typ}"><div class="e-head">'
            f'<span class="badge {typ}">{typ}</span>{breaking}'
            f'<p class="e-text">{esc(e.get("text", ""))}</p></div>'
            + (f'<div class="commits">{chips}</div>' if chips else "")
            + "</section>"
        )
if not blocks:
    blocks.append('<section class="card entry internal"><div class="e-head">'
                  '<span class="badge internal">empty</span>'
                  '<p class="e-text">No changelog entries.</p></div></section>')

# ---- stats from commits.json ----------------------------------------------
commits = co.get("commits", [])
authors = {}
files, ins, dele = 0, 0, 0
for c in commits:
    authors[c.get("author", "?")] = authors.get(c.get("author", "?"), 0) + 1
    files += c.get("files_changed", 0)
    ins += c.get("insertions", 0)
    dele += c.get("deletions", 0)

rows = "".join(
    f"<tr><td>{esc(name)}</td><td>{n} commit{'s' if n != 1 else ''}</td></tr>"
    for name, n in sorted(authors.items(), key=lambda kv: -kv[1])
)

repo_name = (cl.get("repo") or co.get("source") or "repository").rstrip("/")
repo_name = re.sub(r"\.git$", "", repo_name)
repo_name = re.sub(r"\s+since\s+\S+$", "", repo_name).split("/")[-1] or "repository"
sub_bits = [co.get("source", "")]
if co.get("head"): sub_bits.append(f"@ {co['head']}")

slots = {
    "REPO": esc(repo_name),
    "REPO_SUB": esc(" ".join(b for b in sub_bits if b)),
    "GENERATED_AT": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    "RANGE_LABEL": esc(co.get("range_label", "")),
    "SUMMARY_TEXT": esc(cl.get("summary", "")),
    "COMMITS_VALUE": str(co.get("count", len(commits))),
    "AUTHORS_VALUE": str(len(authors)),
    "CHANGES_VALUE": str(files),
    "CHANGES_SUB": f"+{ins} −{dele}",
    "ENTRIES_VALUE": str(entries_total),
    "ENTRIES_SUB": "%d section%s" % (len([s for s in sections if s.get("entries")]),
                                     "" if len([s for s in sections if s.get("entries")]) == 1 else "s"),
    "HIGHLIGHTS_SECTION": hl_html,
    "SECTION_BLOCKS": "\n".join(blocks),
    "CONTRIBUTOR_ROWS": rows,
}
out = tpl
for k, v in slots.items():
    out = out.replace("{{%s}}" % k, v)

leftover = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
if leftover:
    raise SystemExit("unfilled slots: " + ", ".join(leftover))

open(os.path.join(run_dir, "changelog.html"), "w").write(out)
print("changelog.html rendered — %d entries" % entries_total)
PY
RC=$?

if [ $RC -ne 0 ]; then
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"changelog rendering failed"}\n```\n' "$PHASE"
  exit 1
fi

printf '```json\n{"phase":"%s","status":"ok","artifacts":["changelog.html"],"summary":"HTML changelog rendered"}\n```\n' "$PHASE"
