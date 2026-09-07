#!/usr/bin/env bash
# Pages to audit: the home page plus up to seven from the sitemap (or, without
# a sitemap, same-host links on the home page). Also the site language.
set -u
SITE="$REQUEST"; case "$SITE" in http://*|https://*) ;; *) SITE="https://$SITE" ;; esac
SITE="${SITE%/}"
curl -sL --max-time 30 -A "kraftwerk-accessibility-audit" -o home.html "$SITE/" || true
lang=$(grep -o -i '<html[^>]*lang="[^"]*"' home.html | head -1 | sed 's/.*lang="\([^"]*\)".*/\1/' | cut -c1-2 | tr 'A-Z' 'a-z')
echo "${lang:-en}" > lang.txt
curl -sL --max-time 30 -o sitemap.xml "$SITE/sitemap.xml" || true
SITE="$SITE" python3 <<'PY'
import re, os, html
site = os.environ["SITE"]; host = re.sub(r"^https?://", "", site).split("/")[0]
urls = [site + "/"]
sm = open("sitemap.xml", errors="replace").read() if os.path.exists("sitemap.xml") else ""
locs = [html.unescape(u) for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sm)]
if locs and all(l.endswith(".xml") for l in locs[:5]):
    # a sitemap index: take the first child sitemap
    import urllib.request
    try:
        sm = urllib.request.urlopen(urllib.request.Request(locs[0], headers={"User-Agent": "kraftwerk"}), timeout=30).read().decode(errors="replace")
        locs = [html.unescape(u) for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sm)]
    except Exception:
        locs = []
if not locs:
    body = open("home.html", errors="replace").read()
    locs = [html.unescape(h) for h in re.findall(r'href="(https?://' + re.escape(host) + r'/[^"#?]*)"', body)]
    locs += [site + h for h in re.findall(r'href="(/[^"#?/][^"#?]*)"', body)]
for u in locs:
    u = u.rstrip("/") + "/" if not re.search(r"\.[a-z0-9]{2,5}$", u) else u
    if host in u and u not in urls and not re.search(r"\.(pdf|jpg|png|xml|zip)$", u): urls.append(u)
    if len(urls) >= 8: break
open("pages.txt", "w").write("\n".join(urls) + "\n")
print(f"{len(urls)} page(s), language {open('lang.txt').read().strip()}")
PY
