#!/usr/bin/env bash
# URLs from the sitemap (index sitemaps followed, at most 300 URLs), each
# fetched with curl following redirects: status, hops, final URL. No LLM.
set -u
SITE="$REQUEST"; case "$SITE" in http://*|https://*) ;; *) SITE="https://$SITE" ;; esac
SITE="${SITE%/}"
SITE="$SITE" python3 <<'PY'
import re, os, html, urllib.request
site = os.environ["SITE"]
def get(u):
    try: return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "kraftwerk-link-sweep"}), timeout=30).read().decode(errors="replace")
    except Exception: return ""
locs = lambda xml: [html.unescape(u) for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)]
urls = []
seeds = [site + "/sitemap.xml", site + "/sitemap_index.xml"]
seen_maps = set()
while seeds and len(urls) < 300:
    m = seeds.pop(0)
    if m in seen_maps: continue
    seen_maps.add(m)
    for u in locs(get(m)):
        if u.endswith(".xml"): seeds.append(u)
        elif u not in urls: urls.append(u)
if not urls: urls = [site + "/"]
open("urls.txt", "w").write("\n".join(urls[:300]) + "\n")
print(f"{min(len(urls), 300)} URL(s) from {len(seen_maps)} sitemap(s)")
PY
# status without following, then following (hops + final URL); 8 in parallel
fetch() {
  u="$1"
  first=$(curl -s -o /dev/null --max-time 30 -A "kraftwerk-link-sweep" -w '%{http_code}\t%{redirect_url}' "$u")
  final=$(curl -s -o /dev/null --max-time 45 -L --max-redirs 8 -A "kraftwerk-link-sweep" -w '%{http_code}\t%{num_redirects}\t%{url_effective}' "$u")
  printf '%s\t%s\t%s\n' "$u" "$first" "$final"
}
export -f fetch
tr '\n' '\0' < urls.txt | xargs -0 -P 8 -I{} bash -c 'fetch "$@"' _ {} > fetched.tsv
python3 <<'PY'
import json, datetime
rows = []
for line in open("fetched.tsv"):
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 6: continue
    u, first, first_redirect, status, hops, final = parts[:6]
    rows.append({"url": u, "first_status": int(first or 0), "status": int(status or 0), "hops": int(hops or 0), "final": final})
rows.sort(key=lambda r: r["url"])
json.dump({"site": open("urls.txt").readline().strip(), "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "urls": rows}, open("links.json", "w"), indent=2)
print(f"{len(rows)} URL(s) fetched")
PY
