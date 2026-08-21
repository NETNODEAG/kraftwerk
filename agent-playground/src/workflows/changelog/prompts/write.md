Task: turn the extracted commit history into user-facing release notes.

Repository source: `${{ request }}` (checked out under `repo/`, full history).

Input: `commits.json` — the commit range (`range_label`) and one record per
commit: hash, short hash, author, date, subject, body, files changed,
insertions, deletions.

How to work:

1. Read `commits.json` completely.
2. Group commits by what they mean to a USER of the software: one entry per
   change, not per commit. A feature spread over four commits is ONE entry
   listing all four short hashes; a `fix typo` follow-up belongs to the entry
   it fixes.
3. When a subject line is too cryptic to classify (`wip`, `fixes`,
   `refactor stuff`), inspect it before guessing:
   `git -C repo show --stat <hash>` for the shape, `git -C repo show <hash>
   -- <path>` for the diff of one file. Never classify on a hunch when the
   evidence is one command away.
4. Write plain language: what changed and why it matters, not which files
   moved. Rewrite developer shorthand ("refactor X helper") into effect
   ("faster X", "no user-visible change — internal cleanup").

Write `changelog.json`:

```json
{
  "repo": "${{ request }}",
  "range_label": "copied from commits.json",
  "summary": "one paragraph: the story of this release in plain English",
  "highlights": ["3-5 one-line highlights, the changes a user cares about most"],
  "sections": [
    {
      "title": "Features",
      "type": "feature",
      "entries": [
        {
          "text": "user-facing sentence describing the change",
          "commits": ["abc1234", "def5678"],
          "breaking": false
        }
      ]
    }
  ]
}
```

Rules for `changelog.json`:
- `type` is one of: `breaking`, `feature`, `improvement`, `fix`, `docs`,
  `internal`. Only include sections that have entries; order them in exactly
  that sequence.
- Anything that changes existing behaviour or requires user action goes into
  a `breaking` section AND gets `"breaking": true`.
- Every commit hash in `entries[].commits` must exist in `commits.json` —
  never invent hashes.
- Pure noise (merge commits, version bumps, lockfile churn) appears in no
  entry; roll it into one final `internal` entry like "internal maintenance
  (N commits)" if you want to account for it.

Then write `changelog.md` — the same content as markdown: an H1 with repo
name and range, the summary paragraph, a `## Highlights` bullet list, then
one `## <Section title>` per section with `- entry text (abc1234)` bullets.

Do not modify anything under `repo/`. All output in English.
