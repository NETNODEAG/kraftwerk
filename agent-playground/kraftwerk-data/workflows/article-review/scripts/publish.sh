#!/usr/bin/env bash
# Acts on the final human verdict: round 2 if there was one, else round 1.
# Publish → post.md (the draft, dated). Drop → dropped.md with the note.
# Both are valid outcomes, so both exit 0; the last line is the summary.
set -u

FINAL=decision.json
[ -s decision-2.json ] && FINAL=decision-2.json

read -r DECISION NOTE < <(FINAL="$FINAL" python3 - <<'PY'
import json, os
d = json.load(open(os.environ["FINAL"]))
print(str(d.get("decision", "")).lower(), str(d.get("note") or "").replace("\n", " "))
PY
)
DATE="$(date +%Y-%m-%d)"
ROUNDS=1; [ -s feedback.md ] && ROUNDS=2

case "$DECISION" in
  publish)
    { cat draft.md; echo; echo "---"; echo "_Published ${DATE} after ${ROUNDS} review round(s)${NOTE:+ — reviewer: $NOTE}_"; } > post.md
    OUTCOME="published after ${ROUNDS} round(s)${NOTE:+ — $NOTE}"
    ;;
  drop)
    { echo "# Dropped ${DATE}"; echo; echo "> Reviewer: ${NOTE:-no reason given}"; echo; cat draft.md; } > dropped.md
    OUTCOME="dropped after ${ROUNDS} round(s)${NOTE:+ — $NOTE}"
    ;;
  *)
    echo "unexpected final decision: ${DECISION}" >&2
    exit 1
    ;;
esac

echo "$OUTCOME" > outcome.txt
echo "$OUTCOME"
