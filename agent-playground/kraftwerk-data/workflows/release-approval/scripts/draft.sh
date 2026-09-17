#!/usr/bin/env bash
# Drafts a release note from the request — deterministic, no LLM, so the
# demo is about the human step and not about token cost. The request is
# the headline ("Cloudflare tunnel to the inspector"); the body is a stub a
# reviewer can react to.
set -u

TITLE="${REQUEST:-untitled change}"
DATE="$(date +%Y-%m-%d)"

cat > draft.md <<EOF
## ${TITLE}

_Draft ${DATE} — awaiting review_

- What changed: ${TITLE}.
- Why it matters: one sentence for the customer goes here.
- How to try it: one command or one click goes here.
EOF

echo "drafted release note for “${TITLE}”"
