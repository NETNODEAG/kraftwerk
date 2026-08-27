#!/usr/bin/env bash
# HTML -> PDF via headless Chrome (deterministic, no LLM).
set -u

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
done
[ -n "$CHROME" ] || { echo "no Chrome/Chromium binary found" >&2; exit 1; }

"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=10000 \
  --print-to-pdf="$PWD/document.pdf" \
  "file://$PWD/document.html" 2> chrome.log
[ -s document.pdf ] || { echo "document.pdf not produced — see chrome.log" >&2; cat chrome.log >&2; exit 1; }

SIZE=$(wc -c < document.pdf | tr -d ' ')
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["document.pdf"], "summary": "PDF rendered via headless Chrome ($SIZE bytes)"}
\`\`\`
EOF
