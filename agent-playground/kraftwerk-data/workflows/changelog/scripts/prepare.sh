#!/usr/bin/env bash
# Phase "extract history": materialise the repo with full history under
# $RUN_DIR/repo and write commits.json (range + per-commit metadata and
# stats). Deterministic, no LLM.
set -u

SRC="$REQUEST"
DEST="$RUN_DIR/repo"
SINCE_REF=""

# Optional trailing range hint: "<repo> since <ref>".
case "$SRC" in
  *" since "*)
    SINCE_REF="${SRC##* since }"
    SRC="${SRC% since *}"
    ;;
esac

# Accept a pasted `git clone ...` command: pick the URL out of it.
case "$SRC" in
  *"git clone"*)
    SRC=$(printf '%s' "$SRC" | sed 's/.*git clone //')
    PICKED=""
    for tok in $SRC; do
      case "$tok" in
        http://*|https://*|ssh://*|git@*|*.git) PICKED="$tok"; break ;;
      esac
    done
    [ -n "$PICKED" ] && SRC="$PICKED" || SRC=$(printf '%s' "$SRC" | awk '{print $1}')
    ;;
esac

export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"
CLONE_LOG="$RUN_DIR/prepare.log"
: > "$CLONE_LOG"

fail() {
  echo "prepare failed: $1" | tee -a "$CLONE_LOG" >&2
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"%s"}\n```\n' "$PHASE" "$1"
  exit 1
}

rm -rf "$DEST"

# Full-history clone in every case: the changelog needs log, tags and stats.
# A local path is cloned too (git hardlinks objects, so this is cheap) —
# that keeps repo/ read-only-safe and identical to the URL case.
case "$SRC" in
  http://*|https://*|git@*|ssh://*)
    echo "cloning $SRC" >> "$CLONE_LOG"
    git clone "$SRC" "$DEST" >> "$CLONE_LOG" 2>&1 \
      || fail "git clone failed for $SRC (see prepare.log)"
    ;;
  *)
    [ -e "$SRC/.git" ] || fail "not a git repo: $SRC (sandboxed runs need a git URL)"
    echo "cloning local $SRC" >> "$CLONE_LOG"
    git clone "$SRC" "$DEST" >> "$CLONE_LOG" 2>&1 \
      || fail "local git clone failed (see prepare.log)"
    ;;
esac

SINCE_REF="$SINCE_REF" SOURCE="$SRC" python3 - <<'PY' || fail "commit extraction failed"
import json, os, subprocess, sys

run_dir = os.environ["RUN_DIR"]
root = os.path.join(run_dir, "repo")
since = os.environ.get("SINCE_REF", "").strip()
MAX_COMMITS = 300

def git(*args):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout

# Resolve the range: explicit ref > latest tag > last 100 commits.
if since:
    ok = subprocess.run(["git", "-C", root, "rev-parse", "--verify", since],
                        capture_output=True, text=True).returncode == 0
    if not ok:
        sys.exit(f"unknown ref: {since}")
    range_spec, range_label = f"{since}..HEAD", f"{since} → HEAD"
else:
    tag = subprocess.run(["git", "-C", root, "describe", "--tags", "--abbrev=0"],
                         capture_output=True, text=True).stdout.strip()
    if tag:
        range_spec, range_label = f"{tag}..HEAD", f"{tag} → HEAD"
    else:
        range_spec, range_label = f"-{100}", "last 100 commits"

# One pass: records separated by \x1e, fields by \x1f, numstat lines after.
SEP, FS = "\x1e", "\x1f"
fmt = SEP + FS.join(["%H", "%h", "%an", "%ad", "%s", "%b"])
out = git("log", "--date=short", "--numstat", "--no-merges",
          f"--pretty=format:{fmt}", range_spec)

commits = []
for record in out.split(SEP):
    if not record.strip():
        continue
    head, _, stat_block = record.partition("\n")
    parts = (head + "\n" + stat_block).split(FS)
    if len(parts) < 6:
        continue
    full, short, author, date, subject = parts[0], parts[1], parts[2], parts[3], parts[4]
    body_and_stats = parts[5]
    body_lines, files, ins, dele = [], 0, 0, 0
    for line in body_and_stats.splitlines():
        cols = line.split("\t")
        if len(cols) == 3 and (cols[0].isdigit() or cols[0] == "-"):
            files += 1
            if cols[0].isdigit(): ins += int(cols[0])
            if cols[1].isdigit(): dele += int(cols[1])
        elif line.strip():
            body_lines.append(line.rstrip())
    commits.append({
        "hash": full, "short": short, "author": author, "date": date,
        "subject": subject.strip(), "body": "\n".join(body_lines).strip(),
        "files_changed": files, "insertions": ins, "deletions": dele,
    })

truncated = len(commits) > MAX_COMMITS
commits = commits[:MAX_COMMITS]

head_short = git("rev-parse", "--short", "HEAD").strip()
data = {
    "source": os.environ.get("SOURCE", ""),
    "head": head_short,
    "range_label": range_label,
    "range_spec": range_spec,
    "truncated": truncated,
    "count": len(commits),
    "commits": commits,
}
with open(os.path.join(run_dir, "commits.json"), "w") as f:
    json.dump(data, f, indent=2)
print(f"range {range_label}: {len(commits)} commits" + (" (truncated)" if truncated else ""))
PY

N=$(python3 -c 'import json,os; print(json.load(open(os.path.join(os.environ["RUN_DIR"],"commits.json")))["count"])')
LABEL=$(python3 -c 'import json,os; print(json.load(open(os.path.join(os.environ["RUN_DIR"],"commits.json")))["range_label"])')

[ "$N" -gt 0 ] || fail "no commits in range ($LABEL) — nothing to write release notes for"

printf '```json\n{"phase":"%s","status":"ok","artifacts":["repo/","commits.json"],"summary":"Extracted %s commits (%s)"}\n```\n' \
  "$PHASE" "$N" "$LABEL"
