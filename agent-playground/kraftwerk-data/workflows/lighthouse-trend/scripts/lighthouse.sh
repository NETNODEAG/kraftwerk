#!/usr/bin/env bash
# Lighthouse (via npx, the same headless Chrome the PDF workflow uses) per URL,
# at most five. Deterministic, no LLM. Writes lighthouse/<n>.json and scores.json.
set -u
URLS=$(echo "$REQUEST" | tr ',;' '  ' | tr -s ' ' '\n' | grep -v '^$' | awk '!seen[$0]++' | head -5)
[ -n "$URLS" ] || { echo "request must name at least one URL" >&2; exit 2; }
mkdir -p lighthouse
: > urls.txt
n=0
for u in $URLS; do
  case "$u" in http://*|https://*) ;; *) u="https://$u" ;; esac
  # measure the page the URL lands on (a redirect to /de would otherwise be measured)
  final=$(curl -sL -o /dev/null --max-time 30 -w '%{url_effective}' "$u" 2>/dev/null); [ -n "$final" ] && u="$final"
  n=$((n+1)); echo "$u" >> urls.txt
  npx --yes lighthouse "$u" --output=json --output-path="lighthouse/$n.json" --quiet \
    --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" > "lighthouse/$n.log" 2>&1 \
    || echo "lighthouse failed for $u — see lighthouse/$n.log" >&2
done

HISTORY="$RUN_DIR/../../lighthouse-history"
mkdir -p "$HISTORY"
HISTORY="$HISTORY" python3 <<'PY'
import json, os, re, datetime, csv
hist = os.environ["HISTORY"]
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
rows = []
for i, url in enumerate(open("urls.txt").read().split(), 1):
    p = f"lighthouse/{i}.json"
    if not os.path.exists(p): rows.append({"url": url, "error": open(f"lighthouse/{i}.log").read()[-300:]}); continue
    lh = json.load(open(p))
    cat = lh.get("categories", {}); aud = lh.get("audits", {})
    sc = lambda k: round((cat.get(k, {}).get("score") or 0) * 100)
    ms = lambda k: round(aud.get(k, {}).get("numericValue") or 0)
    r = {"url": url, "performance": sc("performance"), "accessibility": sc("accessibility"), "best_practices": sc("best-practices"), "seo": sc("seo"),
         "lcp_ms": ms("largest-contentful-paint"), "cls": round(aud.get("cumulative-layout-shift", {}).get("numericValue") or 0, 3),
         "tbt_ms": ms("total-blocking-time"), "fcp_ms": ms("first-contentful-paint"), "at": stamp,
         "warnings": [w.split(". ")[0] for w in lh.get("runWarnings", [])]}
    key = re.sub(r"[^a-z0-9]+", "-", url.lower().replace("https://", "").replace("http://", "")).strip("-")[:80]
    f = os.path.join(hist, f"{key}.csv"); new = not os.path.exists(f)
    with open(f, "a", newline="") as fh:
        w = csv.writer(fh)
        if new: w.writerow(["at", "performance", "accessibility", "best_practices", "seo", "lcp_ms", "cls", "tbt_ms", "fcp_ms", "warned"])
        w.writerow([r[k] for k in ["at", "performance", "accessibility", "best_practices", "seo", "lcp_ms", "cls", "tbt_ms", "fcp_ms"]] + [1 if r["warnings"] else 0])
    r["history_file"] = f
    rows.append(r)
json.dump({"at": stamp, "results": rows}, open("scores.json", "w"), indent=2)
print(f"{len(rows)} URL(s) measured")
PY
