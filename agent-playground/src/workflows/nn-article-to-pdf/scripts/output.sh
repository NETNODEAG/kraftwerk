#!/usr/bin/env bash
# Prints the result summary and the PDF location.
set -u

SIZE=$(wc -c < document.pdf | tr -d ' ')

echo "== NETNODE Article to PDF =="
python3 - <<'PY'
import json
a = json.load(open("inputs.json"))["article"]
print(f"  title:   {a['title']}")
print(f"  source:  {a['backend']}{a['path']}")
print(f"  node:    {a['bundle']} / {a['uuid']} ({a['langcode']})")
print(f"  body:    {a['body_source']}")
print(f"  image:   {'teaser embedded' if a['has_image'] else 'none'}")
PY
echo
echo "PDF: $RUN_DIR/document.pdf"

TITLE=$(python3 -c 'import json; print(json.load(open("inputs.json"))["article"]["title"])')
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["document.pdf", "document.html", "article.json", "inputs.json"], "summary": "\"$TITLE\" rendered to document.pdf ($SIZE bytes)"}
\`\`\`
EOF
