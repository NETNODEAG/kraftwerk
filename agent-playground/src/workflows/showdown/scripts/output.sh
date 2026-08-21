#!/usr/bin/env bash
# Phase "output results": console summary of the duel.
set -u

python3 <<'PY'
import json, os

run_dir = os.environ["RUN_DIR"]
v = json.load(open(os.path.join(run_dir, "verdict.json")))
winner = v["winner"]
loser = "codex" if winner == "claude" else "claude"

print()
print("Showdown — Claude vs Codex")
print("=" * 60)
print("  Winner:  %s  (%d : %d of %d)"
      % (winner, v["totals"][winner], v["totals"][loser], v["max_points"]))
if v.get("tiebreak"):
    print("  Tiebreak: %s" % v["tiebreak"])
for who in ("claude", "codex"):
    rival = "codex" if who == "claude" else "claude"
    r = json.load(open(os.path.join(run_dir, f"review-by-{rival}.json")))
    print("-" * 60)
    print("  %s — %d/%d, %d words" % (who, v["totals"][who], v["max_points"],
                                      v["word_counts"][who]))
    print("  best line: %s" % r.get("best_line", ""))
print()
print("Scoreboard:  %s/showdown.html" % run_dir)
print()
PY

SUMMARY=$(python3 -c 'import json,os; v=json.load(open(os.path.join(os.environ["RUN_DIR"],"verdict.json"))); print(v["winner"])')
printf '```json\n{"phase":"%s","status":"ok","artifacts":["showdown.html"],"summary":"Duel finished: %s wins"}\n```\n' "$PHASE" "$SUMMARY"
