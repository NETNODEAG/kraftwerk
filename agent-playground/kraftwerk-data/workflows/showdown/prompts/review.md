Review round. The brief was:

> ${{ request }}

Read the RIVAL's draft — the one that is NOT `draft-${{ agent }}.md` — and
score it against the rubric. Judge the text in front of you on its own
merits, as if a stranger wrote it. Your own draft is not the yardstick;
the brief is.

Write `review-by-${{ agent }}.json`:

```json
{
  "reviewer": "${{ agent }}",
  "scores": {
    "brief_fit": { "points": 0, "note": "one sentence: does it answer THIS brief?" },
    "clarity":   { "points": 0, "note": "one sentence: instantly understandable?" },
    "craft":     { "points": 0, "note": "one sentence: word choice, rhythm, economy" },
    "punch":     { "points": 0, "note": "one sentence: does anything stick?" }
  },
  "best_line": "the single strongest line, quoted verbatim from the draft",
  "weakness": "one sentence: the draft's biggest weakness"
}
```

Rules:

- `points` is an integer 0–10 per criterion. Anchor honestly: 5 is
  competent, 8 is strong, 10 is flawless — do not cluster everything at 7.
- Every `note` must point at evidence in the text, not at taste.
- `best_line` must appear verbatim in the rival's draft.
- Valid JSON, nothing else in the file. Do not edit any draft.
- The totals are not yours to compute — a script recomputes and decides.
