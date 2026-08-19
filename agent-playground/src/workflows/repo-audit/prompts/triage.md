Task: triage the raw scanner output into a verified findings list.

Audited repository source: `${{ request }}` (checked out under `repo/`).

Inputs: `inventory.json` (stacks, stats), `scan/candidates.json` (UNVERIFIED
scanner hits), `scan/coverage.json` (what ran).

For EVERY candidate in `scan/candidates.json`:

1. Open the cited file at the cited line and read enough surrounding code to
   judge it in context.
2. Decide: real issue, or false positive?
   Dismiss without mercy: test fixtures and test files, documentation,
   example/sample code, placeholder or clearly fake values (`changeme`,
   `your-api-key`, `xxx`), dead/unreachable code, values that are public by
   design, patterns that are safe in their concrete context (e.g. a constant
   SQL string, `innerHTML` fed from a static literal).
3. Group duplicates: many hits of the same root cause (same secret reused,
   same pattern copy-pasted) become ONE finding listing all locations.

Write `findings.json`:

```json
{
  "repo": "${{ request }}",
  "summary": "one paragraph: overall security posture in plain English",
  "findings": [
    {
      "id": "F1",
      "source": "scanner",
      "category": "secret | dependency | pattern | config",
      "severity": "critical | high | medium | low",
      "title": "short, specific title",
      "locations": ["path/relative/to/repo.js:12"],
      "description": "what is wrong and why it matters, 2-4 sentences",
      "evidence": ["quoted offending line(s), verbatim"],
      "recommendation": "concrete remediation, 1-3 sentences",
      "fix_prompt": "self-contained instruction for a coding agent working inside this repository: name the exact file(s) and line(s), quote the current code, state precisely what to change it to and what must not break. Written so it works with zero additional context."
    }
  ],
  "dismissed": [
    { "candidate_ids": ["c3", "c9"], "reason": "why this is a false positive, one sentence" }
  ]
}
```

Rules:
- Severity honestly: `critical` = exploitable now or leaked live credential;
  `high` = likely exploitable / vulnerable dependency with known fix;
  `medium` = weakness needing preconditions; `low` = hygiene.
- Every candidate id must appear either in a finding (via its locations) or in
  `dismissed` — account for all of them.
- Evidence lines verbatim from the file. Never invent line numbers.
- Do not modify anything under `repo/`.
- All text in English.
