#!/usr/bin/env bash
# Deterministic input collection — no LLM involved.
# Parses the request for markdown file paths, globs or directories, copies
# the files into inputs/ (order preserved) and writes inputs.json.
set -u

python3 <<'PY'
import glob as globmod
import json, os, shlex, shutil, sys

request = os.environ.get("REQUEST", "")
workflow_dir = os.environ.get("WORKFLOW_DIR", "")
# project root = agent-playground (workflow dir is src/workflows/<name>)
project_root = os.path.abspath(os.path.join(workflow_dir, "..", "..", "..")) if workflow_dir else os.getcwd()

MD_EXT = (".md", ".markdown", ".mdown")

def resolve(token):
    token = os.path.expanduser(token)
    if os.path.isabs(token):
        return token
    return os.path.join(project_root, token)

files = []
try:
    tokens = shlex.split(request)
except ValueError:
    tokens = request.split()

for tok in tokens:
    p = resolve(tok)
    if os.path.isdir(p):
        files.extend(sorted(
            os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith(MD_EXT)
        ))
    elif any(c in tok for c in "*?["):
        files.extend(sorted(f for f in globmod.glob(p) if f.lower().endswith(MD_EXT)))
    elif p.lower().endswith(MD_EXT):
        if not os.path.isfile(p):
            print(f"markdown file not found: {tok} (resolved to {p})", file=sys.stderr)
            sys.exit(1)
        files.append(p)
    # other tokens (free-text words in the request) are ignored

# dedupe, order preserved
seen, ordered = set(), []
for f in files:
    real = os.path.realpath(f)
    if real not in seen:
        seen.add(real)
        ordered.append(f)

if not ordered:
    print("no markdown files found in request — pass one or more .md paths, "
          "a glob (docs/*.md) or a directory", file=sys.stderr)
    sys.exit(1)

os.makedirs("inputs", exist_ok=True)
manifest = []
for i, src in enumerate(ordered, 1):
    name = f"{i:02d}-{os.path.basename(src)}"
    shutil.copyfile(src, os.path.join("inputs", name))
    manifest.append({"source": os.path.abspath(src), "name": name})

json.dump({"count": len(manifest), "files": manifest},
          open("inputs.json", "w"), indent=2)
print(f"collected {len(manifest)} markdown file(s)")
PY
rc=$?
[ $rc -ne 0 ] && exit $rc
[ -s inputs.json ] || { echo "inputs.json not produced" >&2; exit 1; }

COUNT=$(python3 -c 'import json; print(json.load(open("inputs.json"))["count"])')
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["inputs.json"], "summary": "collected $COUNT markdown file(s) into inputs/"}
\`\`\`
EOF
