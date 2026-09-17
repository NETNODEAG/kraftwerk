#!/usr/bin/env bash
# The human step. Round 1 (no decision.json yet): publish / revise / drop —
# a "revise" note becomes feedback.md, the writer's brief for the next step.
# Round 2 (after a revise): publish / drop on the rewritten draft.
#
# The run page shows decision-request.json as a form; submitting it writes
# the answer file. The run's discuss chat can do the same when asked. The
# wait stays under 15 minutes: the inspector counts a run with no trace
# event for that long as aborted, and a waiting script writes none.
set -u

WAIT_S="${REVIEW_TIMEOUT:-600}"
if [ -s decision.json ]; then
  ROUND=2; ANSWER=decision-2.json
else
  ROUND=1; ANSWER=decision.json
fi

if [ "$ROUND" = 1 ]; then
  cat > REVIEW.md <<EOF
# Review round 1 — the draft

The writer's article is in \`draft.md\`. Decide:

- **publish** — it goes out as is
- **revise** — say in the note what should change; the writer rewrites the draft with exactly that brief
- **drop** — not worth publishing (note optional)

Easiest: the form at the top of this run's page. Otherwise write \`${ANSWER}\`
in this folder — the run polls for it every 5 s (up to ${WAIT_S} s):

\`\`\`json
{"decision": "revise", "note": "the intro is vague — start with the concrete example, and cut the last section"}
\`\`\`

From a shell: \`echo '{"decision":"publish"}' > "${RUN_DIR}/${ANSWER}"\`

If you are the assistant in this run's chat and the user gives a verdict or
feedback: write that file, with their words as the note, and say so.
EOF
  cat > decision-request.json <<REQ
{
  "title": "Draft ready for review",
  "prompt": "Read draft.md in the artifacts. Publish it as is, ask for a revision (your note is the brief the writer gets), or drop it.",
  "options": [
    {"value": "publish", "label": "Publish"},
    {"value": "revise", "label": "Revise with my note"},
    {"value": "drop", "label": "Drop"}
  ],
  "note": "optional",
  "file": "${ANSWER}"
}
REQ
else
  cat > REVIEW.md <<EOF
# Review round 2 — the revision

The writer rewrote \`draft.md\` from your feedback (\`feedback.md\`); the
section "Changes after review" at the end lists what changed. Decide:

- **publish** — the revision goes out
- **drop** — still not good enough (note optional)

Form on the run page, or write \`${ANSWER}\` in this folder (polled every 5 s,
up to ${WAIT_S} s):

\`\`\`json
{"decision": "publish", "note": "much better"}
\`\`\`

If you are the assistant in this run's chat and the user gives a verdict:
write that file, with their words as the note, and say so.
EOF
  cat > decision-request.json <<REQ
{
  "title": "Revision ready — publish or drop?",
  "prompt": "The writer applied your feedback; see the last section of draft.md for what changed.",
  "options": [
    {"value": "publish", "label": "Publish"},
    {"value": "drop", "label": "Drop"}
  ],
  "note": "optional",
  "file": "${ANSWER}"
}
REQ
fi

echo "round ${ROUND}: waiting for ${ANSWER} in ${RUN_DIR} (up to ${WAIT_S}s) — see REVIEW.md"
for ((waited = 0; waited < WAIT_S; waited += 5)); do
  if [ -s "$ANSWER" ]; then
    ROUND="$ROUND" ANSWER="$ANSWER" python3 - <<'PY'
import json, os, sys
answer, rnd = os.environ["ANSWER"], os.environ["ROUND"]
try:
    d = json.load(open(answer))
except Exception as e:
    print(f"{answer} is not valid JSON: {e}", file=sys.stderr); sys.exit(1)
v = str(d.get("decision", "")).lower()
allowed = ("publish", "revise", "drop") if rnd == "1" else ("publish", "drop")
if v not in allowed:
    print(f'{answer} needs "decision" in {allowed}, got {d.get("decision")!r}', file=sys.stderr); sys.exit(1)
note = str(d.get("note") or "").strip()
if v == "revise":
    # The note is the writer's brief. Without one, the writer still gets a task.
    brief = note or "No specific feedback was given: tighten the text, cut anything generic, keep the structure."
    with open("feedback.md", "w") as f:
        f.write("# Reviewer feedback (round 1)\n\n" + brief + "\n")
print(f"round {rnd}: {v}" + (f" — {note}" if note else ""))
PY
    exit $?
  fi
  sleep 5
done

echo "no decision within ${WAIT_S}s — run again when someone can review" >&2
exit 1
