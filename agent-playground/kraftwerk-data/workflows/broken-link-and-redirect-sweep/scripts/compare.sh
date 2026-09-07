#!/usr/bin/env bash
# report.md against the previous run (output/link-history/<host>.json), then
# store this run as the new baseline. No LLM.
set -u
HISTORY="$RUN_DIR/../../link-history"; mkdir -p "$HISTORY"
HISTORY="$HISTORY" python3 <<'PY'
import json, os, re
d = json.load(open("links.json"))
host = re.sub(r"^https?://", "", d["site"]).split("/")[0]
hf = os.path.join(os.environ["HISTORY"], f"{host}.json")
prev = json.load(open(hf)) if os.path.exists(hf) else None
prev_map = {r["url"]: r for r in prev["urls"]} if prev else {}
cur = d["urls"]
broken = [r for r in cur if r["status"] == 0 or r["status"] >= 400]
chains = [r for r in cur if r["hops"] > 1]
single = [r for r in cur if r["hops"] == 1]
new_broken = [r for r in broken if prev and (r["url"] not in prev_map or not (prev_map[r["url"]]["status"] == 0 or prev_map[r["url"]]["status"] >= 400))]
fixed = [p for u, p in prev_map.items() if (p["status"] == 0 or p["status"] >= 400) and any(c["url"] == u and 200 <= c["status"] < 400 for c in cur)] if prev else []
gone = [u for u in prev_map if u not in {c["url"] for c in cur}] if prev else []
added = [c["url"] for c in cur if c["url"] not in prev_map] if prev else []
L = [f"# Link sweep: {host}", "", f"{len(cur)} URL(s) from the sitemap, checked {d['at'][:16].replace('T', ' ')} UTC.", "", "## Broken", ""]
L += [f"- {r['url']} → {r['status'] or 'no response'}" for r in broken] or ["None."]
L += ["", "## Redirect chains (more than one hop)", ""]
L += [f"- {r['url']} → {r['hops']} hops → {r['final']} ({r['status']})" for r in chains] or ["None."]
L += ["", f"## Redirects (one hop): {len(single)}", ""]
L += [f"- {r['url']} → {r['final']}" for r in single[:30]] + ([f"- … and {len(single) - 30} more"] if len(single) > 30 else [])
L += ["", "## Since the last run", ""]
if not prev: L.append("First run — this is the baseline.")
else:
    L += [f"- newly broken: {len(new_broken)}"] + [f"  - {r['url']} → {r['status'] or 'no response'}" for r in new_broken]
    L += [f"- fixed: {len(fixed)}"] + [f"  - {r['url']}" for r in fixed]
    L += [f"- new in sitemap: {len(added)}", f"- gone from sitemap: {len(gone)}"]
verdict = f"{len(broken)} broken, {len(chains)} chain(s) among {len(cur)} URL(s)" + (f"; {len(new_broken)} newly broken, {len(fixed)} fixed" if prev else "; baseline stored")
L += ["", f"**Verdict:** {verdict}.", ""]
open("report.md", "w").write("\n".join(L)); open("summary.txt", "w").write(verdict + "\n")
json.dump(d, open(hf, "w"), indent=2)
print(verdict)
PY
