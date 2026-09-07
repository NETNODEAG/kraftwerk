#!/usr/bin/env bash
# Phase "scan": deterministic scanners over $RUN_DIR/repo.
# Writes scan/candidates.json (UNVERIFIED findings for agent triage) and
# scan/coverage.json (which scanners ran / were skipped). No LLM.
set -u

mkdir -p "$RUN_DIR/scan"

# ---- dependency audit (needs network + tooling; tolerate absence) ----------
DEP_NOTE="skipped"
if [ -f "$RUN_DIR/repo/package-lock.json" ] && command -v npm >/dev/null 2>&1; then
  (cd "$RUN_DIR/repo" && npm audit --json >"$RUN_DIR/scan/npm-audit.json" 2>"$RUN_DIR/scan/npm-audit.err")
  if [ -s "$RUN_DIR/scan/npm-audit.json" ]; then DEP_NOTE="npm audit ran"; else DEP_NOTE="npm audit failed (see scan/npm-audit.err)"; fi
elif [ -f "$RUN_DIR/repo/package.json" ]; then
  DEP_NOTE="package.json without package-lock.json — npm audit needs a lockfile"
fi

COMPOSER_NOTE="skipped"
if [ -f "$RUN_DIR/repo/composer.lock" ] && command -v composer >/dev/null 2>&1; then
  (cd "$RUN_DIR/repo" && composer audit --format=json >"$RUN_DIR/scan/composer-audit.json" 2>/dev/null)
  [ -s "$RUN_DIR/scan/composer-audit.json" ] && COMPOSER_NOTE="composer audit ran" || COMPOSER_NOTE="composer audit failed"
elif [ -f "$RUN_DIR/repo/composer.json" ]; then
  COMPOSER_NOTE="composer.lock present but composer CLI unavailable"
  [ -f "$RUN_DIR/repo/composer.lock" ] || COMPOSER_NOTE="composer.json without composer.lock"
fi

DEP_NOTE="$DEP_NOTE" COMPOSER_NOTE="$COMPOSER_NOTE" python3 - <<'PY'
import json, os, re

run_dir = os.environ["RUN_DIR"]
root = os.path.join(run_dir, "repo")

SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".next", ".nuxt",
             "__pycache__", ".venv", "venv", "coverage", ".cache"}
SKIP_FILES = {"package-lock.json", "composer.lock", "yarn.lock", "pnpm-lock.yaml",
              "Cargo.lock", "poetry.lock", "Pipfile.lock", "go.sum"}
TEXT_EXT = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".php", ".py", ".rb",
            ".go", ".rs", ".java", ".kt", ".c", ".cc", ".cpp", ".h", ".cs",
            ".sh", ".bash", ".sql", ".twig", ".vue", ".svelte", ".html", ".css",
            ".scss", ".yml", ".yaml", ".json", ".toml", ".ini", ".conf",
            ".env", ".txt", ".md", ".xml", ".properties", ""}
MAX_SIZE = 1_000_000

# ---- secret patterns (category "secret") -----------------------------------
SECRETS = [
    ("aws-access-key",      r"\bAKIA[0-9A-Z]{16}\b"),
    ("private-key-block",   r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY"),
    ("github-token",        r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    ("anthropic-key",       r"\bsk-ant-[A-Za-z0-9_-]{20,}\b"),
    ("openai-key",          r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b"),
    ("slack-token",         r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ("google-api-key",      r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("stripe-key",          r"\b[sr]k_live_[A-Za-z0-9]{20,}\b"),
    ("jwt",                 r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    ("url-basic-auth",      r"\b[a-z][a-z0-9+.-]*://[^/\s:@'\"]+:[^/\s:@'\"]{4,}@"),
    ("hardcoded-password",  r"(?i)\b(?:password|passwd|pwd|secret|api_?key|auth_?token|access_?token)\b\s*[:=]\s*['\"][^'\"\s]{8,}['\"]"),
]

# ---- risky code patterns (category "pattern") ------------------------------
PATTERNS = [
    ("eval",              r"\beval\s*\(", "dynamic code evaluation"),
    ("exec-shell",        r"\b(?:child_process|execSync|exec|spawn|popen|shell_exec|passthru|proc_open|system)\s*\(.*[\"'`].*\$|\bos\.system\s*\(", "shell execution with interpolation"),
    ("sql-concat",        r"(?i)(?:SELECT|INSERT|UPDATE|DELETE)\s.{0,80}(?:\+\s*[a-zA-Z_$]|\"\s*\.\s*\$|'\s*\.\s*\$|\$\{|%s.*%\s*\()", "SQL built by string concatenation"),
    ("inner-html",        r"\.innerHTML\s*=|dangerouslySetInnerHTML", "raw HTML injection sink"),
    ("document-write",    r"\bdocument\.write\s*\(", "document.write sink"),
    ("pickle-load",       r"\bpickle\.loads?\s*\(", "unsafe deserialisation (pickle)"),
    ("yaml-unsafe",       r"\byaml\.load\s*\((?![^)]*SafeLoader)", "yaml.load without SafeLoader"),
    ("php-unserialize",   r"\bunserialize\s*\(", "PHP unserialize on possibly untrusted data"),
    ("weak-hash-password",r"(?i)\b(?:md5|sha1)\s*\(.{0,40}(?:pass|pwd|secret)", "weak hash used for credentials"),
    ("cors-wildcard",     r"(?i)Access-Control-Allow-Origin['\"]?\s*[,:=]\s*['\"]\*", "CORS wildcard"),
    ("debug-true",        r"(?i)\bDEBUG\s*[:=]\s*(?:True|true|1)\b", "debug mode enabled"),
    ("tls-verify-off",    r"(?i)(?:verify\s*[:=]\s*False|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true)", "TLS verification disabled"),
    ("http-url",          r"['\"]http://(?!localhost|127\.0\.0\.1|0\.0\.0\.0|schemas?\.|www\.w3\.org|example\.)[a-z0-9.-]+", "plain-HTTP endpoint"),
]

candidates, cid = [], 0
def add(scanner, category, file, line, match, note):
    global cid
    cid += 1
    candidates.append({"id": f"c{cid}", "scanner": scanner, "category": category,
                       "file": file, "line": line, "match": match[:300], "note": note})

files_scanned = 0
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in filenames:
        if name in SKIP_FILES or name.endswith(".min.js") or name.endswith(".map"):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in TEXT_EXT and not name.startswith(".env"):
            continue
        p = os.path.join(dirpath, name)
        rel = os.path.relpath(p, root)
        try:
            if os.path.getsize(p) > MAX_SIZE:
                continue
            text = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        files_scanned += 1
        lines = text.splitlines()
        for i, line in enumerate(lines, 1):
            if len(line) > 500:
                continue
            for sid, rx in SECRETS:
                if re.search(rx, line):
                    add(sid, "secret", rel, i, line.strip(), "possible credential in source")
            for pid, rx, note in PATTERNS:
                if re.search(rx, line):
                    add(pid, "pattern", rel, i, line.strip(), note)

# ---- committed env files ---------------------------------------------------
try:
    inv = json.load(open(os.path.join(run_dir, "inventory.json")))
    for f in inv.get("committed_env_files", []):
        add("env-file", "config", f, 1, f, "environment file committed to the repo")
except OSError:
    pass

# ---- Dockerfile / gitignore hygiene ---------------------------------------
for dfname in ("Dockerfile",):
    dfp = os.path.join(root, dfname)
    if os.path.exists(dfp):
        df = open(dfp, encoding="utf-8", errors="replace").read()
        if not re.search(r"(?m)^\s*USER\s+", df):
            add("docker-root", "config", dfname, 1, "no USER instruction", "container runs as root")

gi = os.path.join(root, ".gitignore")
gitext = open(gi, encoding="utf-8", errors="replace").read() if os.path.exists(gi) else ""
if os.path.exists(os.path.join(root, "package.json")) and "node_modules" not in gitext:
    add("gitignore-gap", "config", ".gitignore", 1, "node_modules not ignored", "missing .gitignore entry")
if ".env" not in gitext:
    add("gitignore-gap", "config", ".gitignore", 1, ".env not ignored", "missing .gitignore entry")

# ---- npm audit results -----------------------------------------------------
dep_counts = {}
npm_path = os.path.join(run_dir, "scan", "npm-audit.json")
if os.path.exists(npm_path):
    try:
        audit = json.load(open(npm_path))
        vulns = audit.get("vulnerabilities", {})
        for pkg, v in vulns.items():
            sev = v.get("severity", "info")
            dep_counts[sev] = dep_counts.get(sev, 0) + 1
            if sev in ("critical", "high", "moderate"):
                via = v.get("via", [])
                titles = [x.get("title") for x in via if isinstance(x, dict) and x.get("title")]
                add("npm-audit", "dependency", "package-lock.json", 1,
                    f"{pkg} ({sev}): " + ("; ".join(titles[:2]) or "vulnerable range " + str(v.get("range", ""))),
                    f"fix available: {bool(v.get('fixAvailable'))}")
    except (OSError, ValueError):
        pass

composer_path = os.path.join(run_dir, "scan", "composer-audit.json")
if os.path.exists(composer_path):
    try:
        audit = json.load(open(composer_path))
        for pkg, advisories in (audit.get("advisories") or {}).items():
            for adv in advisories:
                add("composer-audit", "dependency", "composer.lock", 1,
                    f"{pkg}: {adv.get('title', 'advisory')}", adv.get("cve") or "")
    except (OSError, ValueError):
        pass

json.dump({"candidates": candidates},
          open(os.path.join(run_dir, "scan", "candidates.json"), "w"), indent=2)

coverage = {
    "files_scanned": files_scanned,
    "scanners": {
        "secret-scan": "ran",
        "pattern-scan": "ran",
        "config-scan": "ran",
        "npm-audit": os.environ["DEP_NOTE"],
        "composer-audit": os.environ["COMPOSER_NOTE"],
        "python-audit": "not implemented (no pip-audit in runner)",
    },
    "dependency_severity_counts": dep_counts,
}
json.dump(coverage, open(os.path.join(run_dir, "scan", "coverage.json"), "w"), indent=2)

by_cat = {}
for c in candidates:
    by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
print(f"scan: {len(candidates)} candidates from {files_scanned} files — " +
      ", ".join(f"{k}: {v}" for k, v in sorted(by_cat.items())))
PY
RC=$?

if [ $RC -ne 0 ]; then
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"scanner run failed"}\n```\n' "$PHASE"
  exit 1
fi

N=$(python3 -c 'import json,os; print(len(json.load(open(os.path.join(os.environ["RUN_DIR"],"scan","candidates.json")))["candidates"]))')
printf '```json\n{"phase":"%s","status":"ok","artifacts":["scan/candidates.json","scan/coverage.json"],"summary":"%s unverified candidates collected"}\n```\n' \
  "$PHASE" "$N"
