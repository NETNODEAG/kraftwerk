Task: manual code review — find what the scanners CANNOT see.

The regex scanners only match textual patterns. Now review the code like a
human security reviewer. Focus on the highest-value surfaces this repo has
(check `inventory.json` for the stack):

- authentication & session handling (login, tokens, password reset, cookies)
- authorization (who can call what — missing ownership/role checks on routes,
  IDOR-style direct object references)
- input handling on every external boundary (HTTP params, file uploads,
  webhooks, CLI args) — injection, path traversal, SSRF
- secrets & config flow (how credentials reach the code; logging of sensitive
  data)
- error handling that leaks internals or fails open
- obvious logic bugs in critical paths (payment, permissions, data deletion)

Method:
1. Use Glob/Grep to locate routes/controllers/handlers, auth code, DB access
   and upload/file handling. Read the important ones fully.
2. Skip generated code, vendored code and tests except where they reveal how
   production code behaves.
3. If the repo is small, read all source files.

Deliverables:

1. `review_notes.md` — your review log:
   - `## Files reviewed` — bullet list of every file you read, with one clause
     on what you checked there
   - `## Areas not covered` — what you skipped and why
2. Update `findings.json`: append any new findings to the `findings` array
   using the same schema as before, with `"source": "manual"` and ids
   continuing the sequence (F5, F6, ...). Include `fix_prompt` for each.
   Update the top-level `summary` so it reflects scanner AND manual results.
   If the manual review finds nothing new, leave `findings` unchanged but
   still update `summary` to say the manual review passed.

Rules: file+line evidence for every claim, no speculative findings without a
concrete code path, do not modify anything under `repo/`, English only.
