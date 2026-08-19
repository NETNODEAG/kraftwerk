#!/usr/bin/env bash
# Prints the result summary and the report location.
set -u

echo "== Website check =="
cat audit_summary.txt
echo
python3 - <<'PY'
import json
a = json.load(open("audit.json"))
for c in a["checks"]:
    mark = {"ok": "PASS", "warning": "WARN", "critical": "FAIL"}[c["status"]]
    print("%-4s  %-18s %s" % (mark, c["label"], c["summary"]))
PY
echo
echo "Report: $RUN_DIR/report.html"
[ -s fix_prompt.txt ] && echo "Fix prompt: $RUN_DIR/fix_prompt.txt (also in the report, with copy button)"

SUMMARY=$(cat audit_summary.txt)
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["report.html", "audit.json"], "summary": "$SUMMARY"}
\`\`\`
EOF
