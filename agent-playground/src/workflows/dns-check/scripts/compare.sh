#!/usr/bin/env bash
# Consensus per record type: the answer set most resolvers returned, and who
# disagrees (a different set, no answer, or no reply). Writes report.md and
# summary.txt from answers.json. No LLM involved.
set -u
python3 <<'PY'
from collections import Counter
import json
d = json.load(open("answers.json"))
domain, types, rows = d["domain"], d["types"], d["results"]
resolvers = []
for r in rows:
    if r["ip"] not in [x["ip"] for x in resolvers]:
        resolvers.append({"resolver": r["resolver"], "ip": r["ip"], "location": r["location"]})

def key(ans): return ", ".join(sorted(ans)) or "(no record)"

lines = [f"# DNS check: {domain}", ""]
lines += ["## Resolvers", "", "| Resolver | Location | " + " | ".join(types) + " | Latency |", "|---|---|" + "---|" * len(types) + "---|"]
for res in resolvers:
    cells, ms = [], []
    for t in types:
        r = next(x for x in rows if x["ip"] == res["ip"] and x["type"] == t)
        if r["status"] == "TIMEOUT": cells.append("no reply")
        elif r["status"] != "NOERROR": cells.append(r["status"])
        else: cells.append(", ".join(r["answers"]) or "—")
        if r["ms"] is not None: ms.append(r["ms"])
    lat = f"{max(ms)} ms" if ms else "—"
    lines.append(f"| {res['resolver']} ({res['ip']}) | {res['location']} | " + " | ".join(cells) + f" | {lat} |")

lines += ["", "## Consensus", ""]
agree_all, disagreements = True, 0
summary = []
for t in types:
    answered = [r for r in rows if r["type"] == t and r["status"] == "NOERROR"]
    silent = [r for r in rows if r["type"] == t and r["status"] != "NOERROR"]
    if not answered:
        lines.append(f"- **{t}**: no resolver answered")
        agree_all = False
        summary.append(f"{t}: no answers")
        continue
    counts = Counter(key(r["answers"]) for r in answered)
    top, n = counts.most_common(1)[0]
    others = [r for r in answered if key(r["answers"]) != top]
    lines.append(f"- **{t}**: `{top}` from {n} of {len(answered)} answering resolvers")
    for r in others:
        lines.append(f"  - {r['resolver']} ({r['location']}) says `{key(r['answers'])}`")
    for r in silent:
        lines.append(f"  - {r['resolver']} ({r['location']}): {'no reply' if r['status'] == 'TIMEOUT' else r['status']}")
    if others:
        agree_all = False
        disagreements += len(others)
    summary.append(f"{t}: {n}/{len(answered)} agree")

verdict = "all answering resolvers agree" if agree_all else f"{disagreements} disagreeing answer(s)"
lines += ["", f"**Verdict:** {verdict}.", ""]
open("report.md", "w").write("\n".join(lines))
open("summary.txt", "w").write(f"{domain}: {verdict} — " + "; ".join(summary) + "\n")
print(open("summary.txt").read().strip())
PY
