#!/usr/bin/env bash
# Phase "render report": findings.json + inventory.json + scan/coverage.json
# -> report.html. Fully deterministic; every slot computed here.
set -u

TEMPLATE="$WORKFLOW_DIR/templates/report.html" python3 <<'PY'
import json, os, re, html, datetime

run_dir = os.environ["RUN_DIR"]
f = json.load(open(os.path.join(run_dir, "findings.json")))
inv = json.load(open(os.path.join(run_dir, "inventory.json")))
cov = json.load(open(os.path.join(run_dir, "scan", "coverage.json")))
tpl = open(os.environ["TEMPLATE"], errors="replace").read()
tpl = re.sub(r"<!--\s*\n?\s*SLOT DOCUMENTATION.*?-->\n?", "", tpl, flags=re.S)

def esc(s):
    # slots_filled fails on any literal "{{" — escape it in content.
    return html.escape(str(s)).replace("{{", "&#123;&#123;")

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
findings = sorted(f.get("findings", []),
                  key=lambda x: SEV_ORDER.get(x.get("severity", "low"), 9))
counts = {s: sum(1 for x in findings if x.get("severity") == s) for s in SEV_ORDER}

worst = next((s for s in SEV_ORDER if counts[s]), None)
verdict_class = worst or "ok"
if findings:
    verdict_label = ", ".join(f"{counts[s]} {s}" for s in SEV_ORDER if counts[s]) + \
        (" finding" if len(findings) == 1 else " findings")
else:
    verdict_label = "no findings"

# ---- finding cards ---------------------------------------------------------
cards = []
for i, x in enumerate(findings):
    sev = x.get("severity", "low")
    locs = x.get("locations", [])
    evid = x.get("evidence", [])
    fid = x.get("id", f"F{i+1}")
    parts = [
        f'<section class="card finding {sev}">',
        '<div class="f-head">',
        f'<span class="badge {sev}">{sev}</span>',
        f"<h2>{esc(x.get('title', fid))}</h2>",
        f'<span class="chip">{esc(x.get("source", "scanner"))}</span>',
        f'<span class="chip">{esc(x.get("category", ""))}</span>' if x.get("category") else "",
        "</div>",
    ]
    if locs:
        parts.append('<div class="locs">%s</div>' % " · ".join(esc(l) for l in locs))
    if x.get("description"):
        parts.append(f'<p class="desc">{esc(x["description"])}</p>')
    if evid:
        parts.append('<pre class="evidence">%s</pre>' % esc("\n".join(evid)))
    if x.get("recommendation"):
        parts.append(f'<p class="rec"><b>Fix:</b> {esc(x["recommendation"])}</p>')
    if x.get("fix_prompt"):
        pid = f"fixp-{fid}"
        parts.append(
            '<details class="fixp"><summary>Fix prompt for a coding agent</summary>'
            f'<div class="fix-body"><button class="copy" data-target="{pid}">Copy prompt</button>'
            f'<pre class="prompt" id="{pid}">{esc(x["fix_prompt"])}</pre></div></details>'
        )
    parts.append("</section>")
    cards.append("".join(p for p in parts if p))

if not cards:
    cards.append(
        '<section class="card finding"><div class="f-head">'
        '<span class="badge ok">clean</span><h2>No verified findings</h2></div>'
        '<p class="desc">All scanner candidates were dismissed as false '
        'positives and the manual review surfaced no issues.</p></section>'
    )

# ---- combined fix prompt ---------------------------------------------------
fix_all = ""
if findings:
    lines = [
        "Fix the following issues found by a security & code audit of this repository.",
        f"Repository: {f.get('repo', inv.get('source', ''))}",
        "",
    ]
    for i, x in enumerate(findings, 1):
        lines.append(f"## Issue {i} — {x.get('title', '')} ({x.get('severity', '')})")
        for l in x.get("locations", []):
            lines.append(f"- location: {l}")
        if x.get("description"):
            lines.append(x["description"])
        if x.get("evidence"):
            lines.append("```")
            lines.extend(x["evidence"])
            lines.append("```")
        if x.get("fix_prompt"):
            lines.append(x["fix_prompt"])
        elif x.get("recommendation"):
            lines.append(x["recommendation"])
        lines.append("")
    lines += [
        "Work through the issues in order (most severe first). Keep changes minimal",
        "and consistent with the existing code style. Never commit secrets — move",
        "them to environment variables and rotate any leaked credential. After each",
        "fix, state what you changed and why.",
    ]
    prompt_text = "\n".join(lines)
    open(os.path.join(run_dir, "fix_prompt.txt"), "w").write(prompt_text)
    fix_all = (
        '<section class="card"><div class="f-head"><h2>Fix all findings</h2></div>'
        '<p class="desc">One combined prompt covering every finding — paste into a '
        'coding agent running inside the repository.</p>'
        '<div class="fix-body"><button class="copy" data-target="fix-all">Copy full prompt</button>'
        f'<pre class="prompt" id="fix-all">{esc(prompt_text)}</pre></div></section>'
    )

# ---- dismissed -------------------------------------------------------------
dismissed = f.get("dismissed", [])
dis_html = ""
if dismissed:
    items = "".join(
        "<li><code>%s</code> — %s</li>" % (esc(", ".join(d.get("candidate_ids", []))), esc(d.get("reason", "")))
        for d in dismissed
    )
    dis_html = (
        f'<details class="dismissed"><summary>{len(dismissed)} dismissed candidate '
        f'group{"s" if len(dismissed) != 1 else ""} (false positives)</summary>'
        f"<ul>{items}</ul></details>"
    )

# ---- coverage rows ---------------------------------------------------------
rows = "".join(
    f"<tr><td>{esc(name)}</td><td>{esc(note)}</td></tr>"
    for name, note in cov.get("scanners", {}).items()
)

repo_name = (f.get("repo") or inv.get("source") or "repository").rstrip("/")
repo_name = re.sub(r"\.git$", "", repo_name).split("/")[-1] or "repository"
sub_bits = [inv.get("source", "")]
if inv.get("commit"): sub_bits.append(f"@ {inv['commit']}")
if inv.get("stacks"): sub_bits.append("· " + ", ".join(inv["stacks"]))

slots = {
    "REPO": esc(repo_name),
    "REPO_SUB": esc(" ".join(b for b in sub_bits if b)),
    "GENERATED_AT": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    "VERDICT_CLASS": verdict_class,
    "VERDICT_LABEL": esc(verdict_label),
    "SUMMARY_TEXT": esc(f.get("summary", "")),
    "CRIT_VALUE": str(counts["critical"]),
    "HIGH_VALUE": str(counts["high"]),
    "MED_VALUE": str(counts["medium"]),
    "LOW_VALUE": str(counts["low"]),
    "FILES_VALUE": str(inv.get("files_total", "–")),
    "FILES_SUB": f"{inv.get('loc_total', 0):,} LOC".replace(",", " "),
    "SCAN_VALUE": str(cov.get("files_scanned", "–")),
    "SCAN_SUB": "%d candidates" % sum(1 for _ in json.load(open(os.path.join(run_dir, "scan", "candidates.json")))["candidates"]),
    "FINDING_CARDS": "\n".join(cards),
    "FIX_ALL_SECTION": fix_all,
    "DISMISSED_SECTION": dis_html,
    "COVERAGE_ROWS": rows,
}
out = tpl
for k, v in slots.items():
    out = out.replace("{{%s}}" % k, v)

leftover = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
if leftover:
    raise SystemExit("unfilled slots: " + ", ".join(leftover))

open(os.path.join(run_dir, "report.html"), "w").write(out)
print("report.html rendered — %d findings, verdict: %s" % (len(findings), verdict_label))
PY
RC=$?

if [ $RC -ne 0 ]; then
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"report rendering failed"}\n```\n' "$PHASE"
  exit 1
fi

printf '```json\n{"phase":"%s","status":"ok","artifacts":["report.html"],"summary":"HTML report rendered"}\n```\n' "$PHASE"
