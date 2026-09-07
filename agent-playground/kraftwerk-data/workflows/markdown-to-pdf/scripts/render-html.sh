#!/usr/bin/env bash
# Markdown -> styled HTML via node + marked (deterministic, no LLM).
set -u

node "$WORKFLOW_DIR/scripts/render-html.mjs" || exit 1
[ -s document.html ] || { echo "document.html not produced" >&2; exit 1; }

cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["document.html"], "summary": "styled HTML document rendered from inputs/"}
\`\`\`
EOF
