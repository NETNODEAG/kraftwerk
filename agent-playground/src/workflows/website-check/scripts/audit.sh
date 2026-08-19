#!/usr/bin/env bash
# Deterministic website audit — no LLM involved.
# Fetches the page with curl, parses/evaluates with python3 stdlib, writes
# audit.json (structured results for the renderer) + audit_summary.txt.
#
# Checks: status_code, title, meta_description, h1, favicon, lang,
#         structure, indexable
set -u

URL="$REQUEST"
case "$URL" in http://*|https://*) ;; *) URL="https://$URL" ;; esac
UA='Mozilla/5.0 (compatible; kraftwerk-website-check/2.0)'

curl -s --max-time 45 -L --max-redirs 10 -A "$UA" \
  -o body.html -D hops.txt \
  -w 'final_status=%{http_code}\nfinal_url=%{url_effective}\nnum_redirects=%{num_redirects}\nttfb=%{time_starttransfer}\ntotal=%{time_total}\nsize=%{size_download}\ncontent_type=%{content_type}\n' \
  "$URL" > fetch.txt 2> fetch_err.txt
echo "curl_exit=$?" >> fetch.txt
touch body.html hops.txt

REQ_URL="$URL" UA="$UA" python3 <<'PY'
import json, os, re, subprocess, datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

UA = os.environ["UA"]
req_url = os.environ["REQ_URL"]

fetch = {}
for line in open("fetch.txt"):
    if "=" in line:
        k, v = line.rstrip("\n").split("=", 1)
        fetch[k] = v
curl_exit = int(fetch.get("curl_exit", "1"))
final_status = int(fetch.get("final_status") or 0)
final_url = fetch.get("final_url") or req_url

# ---- redirect chain from hops.txt (status line + Location per hop) ----
chain, x_robots = [], []
cur = {"status": None, "location": None}
for line in open("hops.txt", errors="replace"):
    line = line.rstrip("\r\n")
    m = re.match(r"^HTTP/[\d.]+\s+(\d+)", line)
    if m:
        if cur["status"]:
            chain.append(cur)
        cur = {"status": int(m.group(1)), "location": None}
    elif line.lower().startswith("location:"):
        cur["location"] = line.split(":", 1)[1].strip()
    elif line.lower().startswith("x-robots-tag:"):
        x_robots.append(line.split(":", 1)[1].strip())
if cur["status"]:
    chain.append(cur)

body = open("body.html", "rb").read().decode("utf-8", "replace")

# ---- parse the document ----
DEPRECATED = {"font", "center", "marquee", "blink", "frame", "frameset", "big", "strike", "acronym"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

class Scan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.doctype = None
        self.titles, self.descriptions, self.robots_metas = [], [], []
        self.icons, self.canonicals, self.h1_texts = [], [], []
        self.heading_seq = []
        self.lang = None
        self.tags = {}
        self.charset = False
        self.viewport = False
        self.deprecated = {}
        self._text_sink = None  # "title" | "h1"

    def handle_decl(self, decl):
        if self.doctype is None:
            self.doctype = decl

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        self.tags[tag] = self.tags.get(tag, 0) + 1
        if tag in DEPRECATED:
            self.deprecated[tag] = self.deprecated.get(tag, 0) + 1
        if tag == "html" and self.lang is None:
            self.lang = a.get("lang", "")
        elif tag == "title":
            self.titles.append("")
            self._text_sink = "title"
        elif tag in HEADINGS:
            self.heading_seq.append(int(tag[1]))
            if tag == "h1":
                self.h1_texts.append("")
                self._text_sink = "h1"
        elif tag == "meta":
            name = a.get("name", "").lower()
            if name == "description":
                self.descriptions.append(a.get("content", ""))
            elif name == "robots":
                self.robots_metas.append(a.get("content", ""))
            if "charset" in a or a.get("http-equiv", "").lower() == "content-type":
                self.charset = True
            if name == "viewport":
                self.viewport = True
        elif tag == "link":
            rel = a.get("rel", "").lower()
            if "icon" in rel and "apple" not in rel:
                self.icons.append(a.get("href", ""))
            elif rel == "canonical":
                self.canonicals.append(a.get("href", ""))

    def handle_endtag(self, tag):
        if tag in ("title", "h1"):
            self._text_sink = None

    def handle_data(self, data):
        if self._text_sink == "title" and self.titles:
            self.titles[-1] += data
        elif self._text_sink == "h1" and self.h1_texts:
            self.h1_texts[-1] += data

doc = Scan()
doc.feed(body)
doc.close()

origin = "{0.scheme}://{0.netloc}".format(urlsplit(final_url))

def curl_status(url):
    """(http_code, content_type) via curl; (0, '') on failure."""
    try:
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "--max-time", "15", "-L",
             "-A", UA, "-w", "%{http_code}\t%{content_type}", url],
            capture_output=True, text=True, timeout=25)
        code, _, ctype = r.stdout.partition("\t")
        return int(code or 0), ctype.strip()
    except Exception:
        return 0, ""

def curl_body(url, out):
    try:
        r = subprocess.run(
            ["curl", "-s", "--max-time", "15", "-L", "-A", UA,
             "-o", out, "-w", "%{http_code}", url],
            capture_output=True, text=True, timeout=25)
        return int(r.stdout or 0)
    except Exception:
        return 0

checks = []
def add(cid, label, status, summary, details=None, evidence=None):
    checks.append({"id": cid, "label": label, "status": status,
                   "summary": summary, "details": details or [],
                   "evidence": evidence or []})

reachable = curl_exit == 0 and 200 <= final_status < 400

# ---- 1. status code ----
ev = []
hop_url = req_url
for hop in chain:
    ev.append("%s  %s" % (hop["status"], hop_url))
    if hop["location"]:
        hop_url = urljoin(hop_url, hop["location"])
if curl_exit != 0:
    err = open("fetch_err.txt", errors="replace").read().strip()
    add("status_code", "Status Code", "critical", "request failed (curl exit %d)" % curl_exit,
        [err or "no response from server"], ev)
elif final_status == 200:
    n = len(chain) - 1
    det = []
    if n > 0:
        det.append("%d redirect%s before the final URL" % (n, "s" if n > 1 else ""))
    if n > 2:
        det.append("more than 2 redirects — shorten the chain")
    add("status_code", "Status Code", "warning" if n > 2 else "ok",
        "200 OK" + (" after %d redirect%s" % (n, "s" if n > 1 else "") if n else ""), det, ev)
elif 200 <= final_status < 300:
    add("status_code", "Status Code", "warning", "final status %d (expected 200)" % final_status, [], ev)
else:
    add("status_code", "Status Code", "critical", "final status %d" % final_status, [], ev)

# ---- 2. title tag ----
titles = [re.sub(r"\s+", " ", t).strip() for t in doc.titles]
t = titles[0] if titles else ""
ev = ['<title>%s</title>' % t] if t else []
if not titles or not t:
    add("title", "Title Tag", "critical", "missing or empty",
        ["every page needs exactly one non-empty <title> in <head>"])
else:
    det, status = [], "ok"
    if len(titles) > 1:
        status, det = "warning", ["%d <title> tags found — keep exactly one" % len(titles)]
    if len(t) < 30:
        status = "warning"; det.append("only %d characters — 30–60 is the usual target" % len(t))
    elif len(t) > 60:
        status = "warning"; det.append("%d characters — may get truncated in search results (target 30–60)" % len(t))
    add("title", "Title Tag", status, "%d characters" % len(t), det, ev)

# ---- 3. meta description ----
descs = [re.sub(r"\s+", " ", d).strip() for d in doc.descriptions]
d = descs[0] if descs else ""
ev = ['content="%s"' % d] if d else []
if not descs or not d:
    add("meta_description", "Meta Description", "critical", "missing or empty",
        ["add <meta name=\"description\"> — search engines use it for the snippet"])
else:
    det, status = [], "ok"
    if len(descs) > 1:
        status, det = "warning", ["%d description metas found — keep exactly one" % len(descs)]
    if len(d) < 50:
        status = "warning"; det.append("only %d characters — 50–160 is the usual target" % len(d))
    elif len(d) > 160:
        status = "warning"; det.append("%d characters — will be truncated in search results (target 50–160)" % len(d))
    add("meta_description", "Meta Description", status, "%d characters" % len(d), det, ev)

# ---- 4. h1 (exactly 1) ----
h1s = [re.sub(r"\s+", " ", h).strip() for h in doc.h1_texts]
ev = ["<h1>%s</h1>" % h for h in h1s[:5]]
if len(h1s) == 1:
    add("h1", "H1 (exactly 1)", "ok" if h1s[0] else "warning",
        "exactly one H1" if h1s[0] else "one H1, but it is empty", [], ev)
elif len(h1s) == 0:
    add("h1", "H1 (exactly 1)", "critical", "no H1 found",
        ["the page needs exactly one H1 as its main heading"])
else:
    add("h1", "H1 (exactly 1)", "warning", "%d H1 tags found" % len(h1s),
        ["keep exactly one H1; demote the others to H2"], ev)

# ---- 5. favicon ----
declared = [h for h in doc.icons if h]
ev, det = [], []
fav_status = None
for href in declared[:3]:
    if href.startswith("data:"):
        ev.append("inline data: icon declared")
        fav_status = fav_status or "ok"
        continue
    fav_url = urljoin(final_url, href)
    code, _ = curl_status(fav_url)
    ev.append("%s  %s" % (code or "ERR", fav_url))
    if code == 200:
        fav_status = "ok"
if fav_status is None:
    code, _ = curl_status(origin + "/favicon.ico")
    ev.append("%s  %s/favicon.ico" % (code or "ERR", origin))
    if code == 200 and declared:
        fav_status, det = "warning", ["declared icon(s) unreachable, only /favicon.ico works"]
    elif code == 200:
        fav_status, det = "ok", ["not declared via <link rel=\"icon\">, but /favicon.ico exists"]
    elif declared:
        fav_status, det = "critical", ["declared icon(s) unreachable and no /favicon.ico fallback"]
    else:
        fav_status, det = "critical", ["no favicon declared and no /favicon.ico"]
add("favicon", "Favicon", fav_status,
    "reachable" if fav_status == "ok" else ("fallback only" if fav_status == "warning" else "missing"),
    det, ev)

# ---- 6. language tag ----
lang = (doc.lang or "").strip()
if not doc.tags.get("html"):
    add("lang", "Language Tag", "critical", "no <html> tag found")
elif not lang:
    add("lang", "Language Tag", "critical", "missing",
        ["add lang=\"…\" to <html> — screen readers and search engines rely on it"],
        ["<html> has no lang attribute"])
elif re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*", lang):
    add("lang", "Language Tag", "ok", 'lang="%s"' % lang, [], ['<html lang="%s">' % lang])
else:
    add("lang", "Language Tag", "warning", 'invalid value "%s"' % lang,
        ["use a BCP-47 code like \"de\" or \"de-CH\""], ['<html lang="%s">' % lang])

# ---- 7. html structure ----
det, ev, status = [], [], "ok"
dt = (doc.doctype or "").lower().strip()
if not dt:
    status = "critical"; det.append("no doctype — browsers fall back to quirks mode")
elif dt != "doctype html":
    status = "warning"; det.append("legacy doctype <!%s>" % doc.doctype)
else:
    ev.append("<!doctype html>")
for tag in ("head", "body"):
    if not doc.tags.get(tag):
        status = "critical"; det.append("no <%s> element" % tag)
if not doc.charset:
    status = "critical" if status == "critical" else "warning"
    det.append("no charset declaration (<meta charset=\"utf-8\">)")
if not doc.viewport:
    status = "critical" if status == "critical" else "warning"
    det.append("no viewport meta — page is not mobile-friendly")
landmarks = {t: doc.tags.get(t, 0) for t in ("header", "nav", "main", "footer")}
missing = [t for t, n in landmarks.items() if n == 0]
ev.append("landmarks: " + ", ".join("%s×%d" % (t, n) for t, n in landmarks.items()))
if len(missing) >= 3:
    status = status if status != "ok" else "warning"
    det.append("no semantic landmarks (%s) — structure is div-only" % ", ".join("<%s>" % m for m in missing))
skips = []
prev = 0
for lvl in doc.heading_seq:
    if prev and lvl > prev + 1:
        skips.append("h%d → h%d" % (prev, lvl))
    prev = lvl
if skips:
    status = status if status != "ok" else "warning"
    det.append("heading levels skipped: " + ", ".join(sorted(set(skips))))
ev.append("headings: " + (", ".join("h%d×%d" % (i, doc.heading_seq.count(i))
          for i in range(1, 7) if doc.heading_seq.count(i)) or "none"))
if doc.deprecated:
    status = status if status != "ok" else "warning"
    det.append("deprecated tags: " + ", ".join("<%s>×%d" % (t, n) for t, n in sorted(doc.deprecated.items())))
add("structure", "HTML Structure", status,
    {"ok": "valid document skeleton", "warning": "%d issue%s" % (len(det), "s" if len(det) != 1 else ""),
     "critical": "broken skeleton"}[status], det, ev)

# ---- 8. indexable ----
det, ev, status = [], [], "ok"
robots_directives = " ".join(doc.robots_metas + x_robots).lower()
for m in doc.robots_metas:
    ev.append('<meta name="robots" content="%s">' % m)
for x in x_robots:
    ev.append("X-Robots-Tag: %s" % x)
robots_code = curl_body(origin + "/robots.txt", "robots.txt")
ev.append("robots.txt: HTTP %s" % (robots_code or "ERR"))
blocked_by_robots = False
if robots_code == 200:
    ua_star, relevant = False, []
    for line in open("robots.txt", errors="replace"):
        line = line.split("#", 1)[0].strip()
        m = re.match(r"(?i)(user-agent|disallow)\s*:\s*(.*)", line)
        if not m:
            continue
        key, val = m.group(1).lower(), m.group(2).strip()
        if key == "user-agent":
            ua_star = val == "*"
        elif key == "disallow" and ua_star and val:
            relevant.append(val)
            if val == "/":
                blocked_by_robots = True
    if relevant:
        ev.append("robots.txt disallows (ua *): " + ", ".join(relevant[:8]))
if not reachable:
    status = "critical"; det.append("page does not answer with a success status — nothing to index")
if "noindex" in robots_directives:
    status = "critical"; det.append("noindex directive present — page is excluded from search")
if blocked_by_robots:
    status = "critical"; det.append("robots.txt blocks all crawling for User-agent: * (Disallow: /)")
canon = doc.canonicals[0].strip() if doc.canonicals else ""
if canon:
    canon_abs = urljoin(final_url, canon)
    ev.append('<link rel="canonical" href="%s">' % canon)
    if canon_abs.rstrip("/") != final_url.rstrip("/"):
        if status == "ok":
            status = "warning"
        det.append("canonical points to a different URL — this page defers to %s" % canon_abs)
else:
    det.append("no canonical link (not required, but recommended)")
    if status == "ok":
        ev.append("no canonical declared")
if "nofollow" in robots_directives and status == "ok":
    status = "warning"; det.append("nofollow directive — links from this page pass no signals")
add("indexable", "Indexable", status,
    {"ok": "indexable", "warning": "indexable with caveats", "critical": "not indexable"}[status], det, ev)

# ---- write results ----
score = {s: sum(1 for c in checks if c["status"] == s) for s in ("ok", "warning", "critical")}
overall = "critical" if score["critical"] else ("warning" if score["warning"] else "ok")
out = {
    "url": req_url,
    "final_url": final_url,
    "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    "overall": overall,
    "score": score,
    "fetch": {
        "final_status": final_status,
        "redirects": max(len(chain) - 1, 0),
        "ttfb_s": float(fetch.get("ttfb") or 0),
        "total_s": float(fetch.get("total") or 0),
        "size_bytes": int(float(fetch.get("size") or 0)),
        "content_type": fetch.get("content_type", ""),
    },
    "checks": checks,
}
json.dump(out, open("audit.json", "w"), indent=2, ensure_ascii=False)
host = urlsplit(final_url).netloc or req_url
open("audit_summary.txt", "w").write(
    "%s: %d ok, %d warning, %d critical" % (host, score["ok"], score["warning"], score["critical"]))
PY
[ -s audit.json ] || { echo "audit.json not produced" >&2; exit 1; }

SUMMARY=$(cat audit_summary.txt)
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["audit.json"], "summary": "$SUMMARY"}
\`\`\`
EOF
