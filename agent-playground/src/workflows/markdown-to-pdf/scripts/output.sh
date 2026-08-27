#!/usr/bin/env bash
# Prints the result summary and the PDF location.
set -u

COUNT=$(python3 -c 'import json; print(json.load(open("inputs.json"))["count"])')
SIZE=$(wc -c < document.pdf | tr -d ' ')

echo "== Markdown to PDF =="
python3 - <<'PY'
import json
for f in json.load(open("inputs.json"))["files"]:
    print("  -", f["source"])
PY
echo
echo "PDF: $RUN_DIR/document.pdf"

cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["document.pdf", "document.html", "inputs.json"], "summary": "$COUNT markdown file(s) rendered to document.pdf ($SIZE bytes)"}
\`\`\`
EOF
