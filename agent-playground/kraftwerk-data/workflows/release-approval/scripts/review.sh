#!/usr/bin/env bash
# The human step, the way it can work today: block until a person writes
# decision.json into this run folder, then hand the decision on. Two ways to
# decide, both written to REVIEW.md so the run's "⌬ discuss" chat (whose
# working directory is this folder) can do it when asked:
#
#   form:  the run page shows decision-request.json as a form
#   chat:  open the run → discuss → "approve" or "reject: <why>"
#   shell: echo '{"decision":"approve"}' > "$RUN_DIR/decision.json"
#
# The wait stays under 15 minutes: the inspector counts a run with no trace
# event for that long as aborted, and a waiting script writes none.
set -u

WAIT_S="${REVIEW_TIMEOUT:-600}"
DRAFT="$(cat draft.md 2>/dev/null || echo '(no draft)')"

cat > REVIEW.md <<EOF
# Review needed

A release note is waiting for a decision. Read it in \`draft.md\`:

${DRAFT}

## How to decide

Easiest: the form at the top of this run's page in the inspector.

Otherwise write \`decision.json\` in this folder — the run polls for it every 5 s
(up to ${WAIT_S} s, then it fails and can be run again):

\`\`\`json
{"decision": "approve", "note": "optional remark"}
\`\`\`

or

\`\`\`json
{"decision": "reject", "note": "what should change"}
\`\`\`

From a shell: \`echo '{"decision":"approve"}' > "${RUN_DIR}/decision.json"\`

If you are the assistant in this run's chat and the user says approve or
reject: write that file, with their words as the note, and say so.
EOF

# The run page renders this as a form; submitting it writes decision.json.
cat > decision-request.json <<REQ
{
  "title": "Release note ready for review",
  "prompt": "Read draft.md in the artifacts. Approve to publish it, or reject with a note saying what should change.",
  "options": [{"value": "approve", "label": "Approve"}, {"value": "reject", "label": "Reject"}],
  "note": "optional"
}
REQ

echo "waiting for decision.json in ${RUN_DIR} (up to ${WAIT_S}s) — see REVIEW.md"
for ((waited = 0; waited < WAIT_S; waited += 5)); do
  if [ -s decision.json ]; then
    python3 - <<'PY'
import json, sys
try:
    d = json.load(open("decision.json"))
except Exception as e:
    print(f"decision.json is not valid JSON: {e}", file=sys.stderr); sys.exit(1)
v = str(d.get("decision", "")).lower()
if v not in ("approve", "reject"):
    print(f'decision.json needs "decision": "approve" or "reject", got {d.get("decision")!r}', file=sys.stderr); sys.exit(1)
note = str(d.get("note") or "").strip()
print(f"decision: {v}" + (f" — {note}" if note else ""))
PY
    exit $?
  fi
  sleep 5
done

echo "no decision within ${WAIT_S}s — run again when someone can review" >&2
exit 1
