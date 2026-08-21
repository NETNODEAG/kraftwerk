#!/usr/bin/env bash
# Phase "output results": console summary of the release notes.
set -u

python3 - <<'PY'
import json, os

run_dir = os.environ["RUN_DIR"]
cl = json.load(open(os.path.join(run_dir, "changelog.json")))
co = json.load(open(os.path.join(run_dir, "commits.json")))

print()
print("Changelog — %s" % co.get("source", ""))
print("Range: %s (%d commits)" % (co.get("range_label", ""), co.get("count", 0)))
print("=" * 60)
for h in cl.get("highlights", []):
    print("  * %s" % h)
print("-" * 60)
for sec in cl.get("sections", []):
    n = len(sec.get("entries", []))
    if n:
        print("  %-14s %d entr%s" % (sec.get("title", "?"), n, "y" if n == 1 else "ies"))
print()
print("Report:    %s/changelog.html" % run_dir)
print("Markdown:  %s/changelog.md" % run_dir)
print()
PY

N=$(python3 -c 'import json,os; print(sum(len(s.get("entries",[])) for s in json.load(open(os.path.join(os.environ["RUN_DIR"],"changelog.json")))["sections"]))')
printf '```json\n{"phase":"%s","status":"ok","artifacts":["changelog.html","changelog.md"],"summary":"Release notes finished: %s entries"}\n```\n' \
  "$PHASE" "$N"
