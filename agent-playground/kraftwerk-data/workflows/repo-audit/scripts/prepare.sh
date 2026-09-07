#!/usr/bin/env bash
# Phase "prepare": materialise the repo under $RUN_DIR/repo and write
# inventory.json (stacks, file/LOC stats, notable files). Deterministic, no LLM.
set -u

SRC="$REQUEST"
DEST="$RUN_DIR/repo"

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

# Non-interactive SSH: accept unseen host keys (fresh sandbox containers have
# no known_hosts for bitbucket/github).
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"
CLONE_LOG="$RUN_DIR/prepare.log"
: > "$CLONE_LOG"

fail() {
  echo "prepare failed: $1" | tee -a "$CLONE_LOG" >&2
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"%s"}\n```\n' "$PHASE" "$1"
  exit 1
}

rm -rf "$DEST"

case "$SRC" in
  http://*|https://*|git@*|ssh://*)
    echo "cloning $SRC" >> "$CLONE_LOG"
    git clone --depth 1 "$SRC" "$DEST" >> "$CLONE_LOG" 2>&1 \
      || fail "git clone failed for $SRC (see prepare.log)"
    ;;
  *)
    [ -d "$SRC" ] || fail "local path not found: $SRC (sandboxed runs need a git URL)"
    echo "copying $SRC" >> "$CLONE_LOG"
    mkdir -p "$DEST"
    # Copy working tree incl. uncommitted changes; skip heavy/derived dirs.
    rsync -a \
      --exclude .git --exclude node_modules --exclude vendor \
      --exclude dist --exclude build --exclude .next --exclude .nuxt \
      --exclude __pycache__ --exclude .venv --exclude venv \
      --exclude coverage --exclude .cache \
      "$SRC"/ "$DEST"/ >> "$CLONE_LOG" 2>&1 \
      || fail "rsync copy failed (see prepare.log)"
    ;;
esac

python3 - <<'PY' || fail "inventory generation failed"
import json, os, subprocess

root = os.path.join(os.environ["RUN_DIR"], "repo")
req = os.environ["REQUEST"]

SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".next", ".nuxt",
             "__pycache__", ".venv", "venv", "coverage", ".cache"}
CODE_EXT = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".php", ".py", ".rb",
            ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cc", ".cpp", ".h",
            ".cs", ".sh", ".bash", ".sql", ".twig", ".vue", ".svelte", ".html",
            ".css", ".scss", ".yml", ".yaml", ".json", ".toml", ".env", ".md"}

by_ext, files_total, loc_total = {}, 0, 0
notable, env_files = [], []

NOTABLE = {"package.json", "package-lock.json", "composer.json", "composer.lock",
           "requirements.txt", "pyproject.toml", "Pipfile", "Gemfile", "go.mod",
           "Cargo.toml", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
           ".gitignore", ".env.example", "Makefile", "settings.php", "wp-config.php"}

for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in filenames:
        p = os.path.join(dirpath, name)
        rel = os.path.relpath(p, root)
        files_total += 1
        ext = os.path.splitext(name)[1].lower()
        by_ext[ext or "(none)"] = by_ext.get(ext or "(none)", 0) + 1
        if name in NOTABLE:
            notable.append(rel)
        if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
            env_files.append(rel)
        if ext in CODE_EXT:
            try:
                with open(p, "rb") as f:
                    loc_total += f.read().count(b"\n")
            except OSError:
                pass

stacks = []
def has(*names): return any(os.path.exists(os.path.join(root, n)) for n in names)
if has("package.json"): stacks.append("node")
if has("composer.json"): stacks.append("php")
if has("requirements.txt", "pyproject.toml", "Pipfile"): stacks.append("python")
if has("Gemfile"): stacks.append("ruby")
if has("go.mod"): stacks.append("go")
if has("Cargo.toml"): stacks.append("rust")
if has("Dockerfile", "docker-compose.yml", "docker-compose.yaml"): stacks.append("docker")
if has("core/lib/Drupal.php") or os.path.isdir(os.path.join(root, "web", "core")): stacks.append("drupal")
if has("wp-config.php", "wp-config-sample.php"): stacks.append("wordpress")

head = ""
try:
    head = subprocess.run(["git", "-C", root, "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
except OSError:
    pass

top_ext = sorted(by_ext.items(), key=lambda kv: -kv[1])[:15]
inv = {
    "source": req,
    "commit": head or None,
    "stacks": stacks,
    "files_total": files_total,
    "loc_total": loc_total,
    "files_by_ext": dict(top_ext),
    "notable_files": sorted(notable),
    "committed_env_files": sorted(env_files),
}
with open(os.path.join(os.environ["RUN_DIR"], "inventory.json"), "w") as f:
    json.dump(inv, f, indent=2)
print(f"inventory: {files_total} files, {loc_total} LOC, stacks: {', '.join(stacks) or 'unknown'}")
PY

FILES=$(python3 -c 'import json,os; print(json.load(open(os.path.join(os.environ["RUN_DIR"],"inventory.json")))["files_total"])')
STACKS=$(python3 -c 'import json,os; print(", ".join(json.load(open(os.path.join(os.environ["RUN_DIR"],"inventory.json")))["stacks"]) or "unknown")')

printf '```json\n{"phase":"%s","status":"ok","artifacts":["repo/","inventory.json"],"summary":"Repo materialised: %s files, stacks: %s"}\n```\n' \
  "$PHASE" "$FILES" "$STACKS"
