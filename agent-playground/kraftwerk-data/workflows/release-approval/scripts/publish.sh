#!/usr/bin/env bash
# Acts on the human's decision. Approve → published.md (the draft, dated and
# marked approved). Reject → rejected.md with the reviewer's note. Both are
# valid outcomes of the workflow, so both exit 0; the last line becomes the
# run's summary and outcome.txt carries it for the gate.
set -u

read -r DECISION NOTE < <(python3 - <<'PY'
import json
d = json.load(open("decision.json"))
print(str(d.get("decision", "")).lower(), str(d.get("note") or "").replace("\n", " "))
PY
)
DATE="$(date +%Y-%m-%d)"

case "$DECISION" in
  approve)
    { sed 's/^_Draft .*_$/_Published '"${DATE}"' — approved by a human_/' draft.md; echo; [ -n "$NOTE" ] && echo "> Reviewer: ${NOTE}"; } > published.md
    OUTCOME="published${NOTE:+ — $NOTE}"
    ;;
  reject)
    { echo "# Rejected ${DATE}"; echo; echo "> Reviewer: ${NOTE:-no reason given}"; echo; cat draft.md; } > rejected.md
    OUTCOME="rejected${NOTE:+ — $NOTE}"
    ;;
  *)
    echo "unknown decision: ${DECISION}" >&2
    exit 1
    ;;
esac

echo "$OUTCOME" > outcome.txt
echo "$OUTCOME"
