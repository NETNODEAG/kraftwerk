#!/usr/bin/env bash
# Phase "output results": console summary of the audit.
set -u

python3 - <<'PY'
import json, os

run_dir = os.environ["RUN_DIR"]
f = json.load(open(os.path.join(run_dir, "findings.json")))
findings = f.get("findings", [])
order = ["critical", "high", "medium", "low"]
findings.sort(key=lambda x: order.index(x.get("severity", "low")) if x.get("severity") in order else 9)

print()
print("Repo audit — %s" % f.get("repo", ""))
print("=" * 60)
if not findings:
    print("CLEAN — no verified findings.")
else:
    for x in findings:
        sev = x.get("severity", "?").upper()
        loc = (x.get("locations") or [""])[0]
        print("%-9s %-45s %s" % (sev, x.get("title", "")[:45], loc))
    print("-" * 60)
    counts = {s: sum(1 for x in findings if x.get("severity") == s) for s in order}
    print("  " + "  ".join("%s: %d" % (s, counts[s]) for s in order if counts[s]))
print()
print("Report:      %s/report.html" % run_dir)
if os.path.exists(os.path.join(run_dir, "fix_prompt.txt")):
    print("Fix prompt:  %s/fix_prompt.txt" % run_dir)
print()
PY

N=$(python3 -c 'import json,os; print(len(json.load(open(os.path.join(os.environ["RUN_DIR"],"findings.json")))["findings"]))')
printf '```json\n{"phase":"%s","status":"ok","artifacts":["report.html","findings.json"],"summary":"Audit finished: %s verified findings"}\n```\n' \
  "$PHASE" "$N"
