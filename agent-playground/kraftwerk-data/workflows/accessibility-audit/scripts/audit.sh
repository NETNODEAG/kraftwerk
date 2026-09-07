#!/usr/bin/env bash
# axe-core through Lighthouse's accessibility category per page. No LLM.
# Writes lighthouse/<n>.json, violations.json and findings.md.
set -u
mkdir -p lighthouse
n=0
while read -r u; do
  [ -z "$u" ] && continue
  n=$((n+1))
  npx --yes lighthouse "$u" --output=json --output-path="lighthouse/$n.json" --quiet --only-categories=accessibility \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" > "lighthouse/$n.log" 2>&1 || echo "lighthouse failed for $u" >&2
done < pages.txt
python3 <<'PY'
import json, os
pages = open("pages.txt").read().split()
rules = {}
scores = []
for i, u in enumerate(pages, 1):
    p = f"lighthouse/{i}.json"
    if not os.path.exists(p): continue
    lh = json.load(open(p))
    scores.append((u, round((lh["categories"]["accessibility"]["score"] or 0) * 100)))
    for aid, a in lh["audits"].items():
        if a.get("score") == 0 and a.get("details", {}).get("items"):
            r = rules.setdefault(aid, {"id": aid, "title": a["title"], "description": a["description"], "impact": "", "pages": {}, "count": 0})
            items = a["details"]["items"]
            r["pages"][u] = len(items); r["count"] += len(items)
            if not r["impact"]:
                r["impact"] = (items[0].get("node", {}).get("explanation") or "").split("\n")[0][:160]
            r.setdefault("examples", [])
            for it in items[:2]:
                sn = it.get("node", {}).get("snippet")
                if sn and sn not in r["examples"] and len(r["examples"]) < 3: r["examples"].append(sn[:160])
order = sorted(rules.values(), key=lambda r: (-len(r["pages"]), -r["count"]))
json.dump({"pages": pages, "scores": scores, "rules": order}, open("violations.json", "w"), indent=2)
L = ["# Accessibility findings", "", "## Pages", ""] + [f"- {u}: score {s}" for u, s in scores] + ["", "## Violations by rule", ""]
if not order: L.append("No violations found by axe-core on the audited pages.")
for r in order:
    L += [f"### {r['id']} — {r['title']}", "", r["description"].split(" [Learn")[0], "", f"- occurrences: {r['count']} on {len(r['pages'])} page(s)"]
    L += [f"- {u}: {c}" for u, c in r["pages"].items()]
    if r.get("examples"): L += ["- examples:"] + [f"  - `{e}`" for e in r["examples"]]
    L.append("")
open("findings.md", "w").write("\n".join(L))
open("summary.txt", "w").write(f"{len(order)} rule(s) violated on {len(pages)} page(s); scores " + ", ".join(str(s) for _, s in scores) + "\n")
print(open("summary.txt").read().strip())
PY
