#!/usr/bin/env bash
# Phase "tally verdict": the reviews are agent opinions; the verdict is not.
# Recompute each contestant's total from the raw criterion points (never
# trust a model's arithmetic), pick the winner, break ties deterministically:
# the shorter draft wins.
set -u

python3 <<'PY'
import json, os, sys

run_dir = os.environ["RUN_DIR"]
CRITERIA = ["brief_fit", "clarity", "craft", "punch"]

def load(name):
    with open(os.path.join(run_dir, name)) as f:
        return json.load(f)

def total(review, whose):
    scores = review.get("scores", {})
    pts = 0
    for c in CRITERIA:
        p = scores.get(c, {}).get("points")
        if not isinstance(p, int) or not 0 <= p <= 10:
            sys.exit(f"review of {whose}: criterion '{c}' has no integer 0-10 points")
        pts += p
    return pts

def words(name):
    with open(os.path.join(run_dir, name)) as f:
        return len(f.read().split())

# Crossed reviews: claude's total comes from codex's review and vice versa.
totals = {
    "claude": total(load("review-by-codex.json"), "claude"),
    "codex": total(load("review-by-claude.json"), "codex"),
}
counts = {"claude": words("draft-claude.md"), "codex": words("draft-codex.md")}

tiebreak = None
if totals["claude"] != totals["codex"]:
    winner = max(totals, key=totals.get)
elif counts["claude"] != counts["codex"]:
    winner, tiebreak = min(counts, key=counts.get), "brevity"
else:
    winner, tiebreak = "claude", "alphabetical"

verdict = {
    "winner": winner,
    "margin": abs(totals["claude"] - totals["codex"]),
    "totals": totals,
    "max_points": len(CRITERIA) * 10,
    "word_counts": counts,
    "tiebreak": tiebreak,
}
with open(os.path.join(run_dir, "verdict.json"), "w") as f:
    json.dump(verdict, f, indent=2)

print("claude %d : %d codex — winner %s%s"
      % (totals["claude"], totals["codex"], winner,
         f" (tiebreak: {tiebreak})" if tiebreak else ""))
PY
RC=$?

if [ $RC -ne 0 ]; then
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"tally failed: malformed review scores"}\n```\n' "$PHASE"
  exit 1
fi

SUMMARY=$(python3 -c 'import json,os; v=json.load(open(os.path.join(os.environ["RUN_DIR"],"verdict.json"))); loser="codex" if v["winner"]=="claude" else "claude"; print("%s wins %d:%d" % (v["winner"], v["totals"][v["winner"]], v["totals"][loser]))')
printf '```json\n{"phase":"%s","status":"ok","artifacts":["verdict.json"],"summary":"%s"}\n```\n' "$PHASE" "$SUMMARY"
