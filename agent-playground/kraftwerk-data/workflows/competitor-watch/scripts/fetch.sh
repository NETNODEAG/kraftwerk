#!/usr/bin/env bash
# Fetch each URL, keep its visible text, diff against the baseline concept in
# the competitor-watch knowledge bundle, then store the new text as that
# concept (kraftwerk knowledge put — provenance stamped, log and index kept).
# No LLM.
set -u
URLS=$(echo "$REQUEST" | tr ',;' '  ' | tr -s ' ' '\n' | grep -v '^$' | awk '!seen[$0]++')
[ -n "$URLS" ] || { echo "request must name at least one URL" >&2; exit 2; }
BUNDLE="competitor-watch"
mkdir -p pages raw baseline
: > urls.txt; : > slugs.txt
n=0
for u in $URLS; do
  case "$u" in http://*|https://*) ;; *) u="https://$u" ;; esac
  n=$((n+1)); echo "$u" >> urls.txt
  curl -sL --max-time 40 -A "Mozilla/5.0 (compatible; kraftwerk-competitor-watch)" -o "raw/$n.html" "$u" || true
  slug=$(echo "$u" | sed -E -e 's#^https?://##' -e 's#/*$##' | tr -c 'a-zA-Z0-9\n' '-' | tr -s '-' | sed 's/^-//;s/-$//' | tr 'A-Z' 'a-z' | cut -c1-80)
  echo "$slug" >> slugs.txt
  # the previous copy, if the bundle has one (frontmatter stripped below)
  npx --no-install kraftwerk knowledge get "$BUNDLE/pages/$slug" > "baseline/$n.md" 2>/dev/null || : > "baseline/$n.md"
done

BUNDLE="$BUNDLE" python3 <<'PY'
import os, re, json, difflib, datetime
from html.parser import HTMLParser
class Text(HTMLParser):
    def __init__(s): super().__init__(); s.out = []; s.skip = 0
    def handle_starttag(s, t, a):
        if t in ("script", "style", "noscript", "svg"): s.skip += 1
        if t in ("p", "div", "li", "h1", "h2", "h3", "h4", "br", "tr", "section", "article"): s.out.append("\n")
    def handle_endtag(s, t):
        if t in ("script", "style", "noscript", "svg"): s.skip = max(0, s.skip - 1)
    def handle_data(s, d):
        if not s.skip: s.out.append(d)
def body_of(md):
    # strip the OKF frontmatter block and the blank line after it
    m = re.match(r"^---\n.*?\n---\n\n?", md, re.S)
    return md[m.end():] if m else md
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
urls = open("urls.txt").read().split(); slugs = open("slugs.txt").read().split()
results = []
L = ["# Competitor watch", "", f"Checked {stamp} UTC. Baselines: knowledge bundle `{os.environ['BUNDLE']}`, concept pages/<slug>.", ""]
for i, (url, slug) in enumerate(zip(urls, slugs), 1):
    raw = open(f"raw/{i}.html", errors="replace").read() if os.path.exists(f"raw/{i}.html") else ""
    p = Text(); p.feed(raw)
    text = "\n".join(l for l in (re.sub(r"\s+", " ", x).strip() for x in "".join(p.out).split("\n")) if l)
    open(f"pages/{i}.txt", "w").write(text)
    old = body_of(open(f"baseline/{i}.md").read()).rstrip("\n")
    r = {"url": url, "slug": slug, "chars": len(text)}
    if not raw:
        r["state"] = "failed"; L += [f"## {url}", "", "state: failed (no response)", ""]
    elif not old:
        r["state"] = "first seen"; L += [f"## {url}", "", "state: first seen — baseline stored", ""]
    elif old == text:
        r["state"] = "unchanged"; L += [f"## {url}", "", "state: unchanged", ""]
    else:
        diff = list(difflib.unified_diff(old.splitlines(), text.splitlines(), "before", "now", lineterm="", n=1))
        r["state"] = "changed"; r["diff_lines"] = len(diff)
        L += [f"## {url}", "", f"state: changed ({len(diff)} diff lines)", "", "```diff"] + diff[:200] + (["… (truncated)"] if len(diff) > 200 else []) + ["```", ""]
    if raw:
        host = re.sub(r"^https?://", "", url).split("/")[0]
        fm = ["---", "type: Snapshot", f"title: {json.dumps(url)}",
              f"description: {json.dumps('Visible text of ' + url + ' as fetched by competitor-watch on ' + stamp + ' UTC; the baseline the next run diffs against.')}",
              "tags: [ competitor, snapshot ]", f"url: {json.dumps(url)}", f"host: {json.dumps(host)}", f"fetched: {json.dumps(stamp + ' UTC')}", "---", ""]
        open(f"baseline/{i}.new.md", "w").write("\n".join(fm) + text + "\n")
    results.append(r)
json.dump({"at": stamp, "bundle": os.environ["BUNDLE"], "pages": results}, open("changes.json", "w"), indent=2)
open("changes.md", "w").write("\n".join(L))
ch = sum(1 for r in results if r["state"] == "changed"); fs = sum(1 for r in results if r["state"] == "first seen")
open("summary.txt", "w").write(f"{ch} changed, {fs} first seen, {len(results) - ch - fs} unchanged or failed of {len(results)} page(s)\n")
print(open("summary.txt").read().strip())
PY

# store the new copies as concepts (skipped for pages that did not load)
n=0
while read -r slug; do
  n=$((n+1))
  [ -s "baseline/$n.new.md" ] || continue
  npx --no-install kraftwerk knowledge put "$BUNDLE/pages/$slug" --file "baseline/$n.new.md" --actor process:competitor-watch >/dev/null \
    || echo "could not store baseline for $slug in bundle $BUNDLE" >&2
done < slugs.txt
