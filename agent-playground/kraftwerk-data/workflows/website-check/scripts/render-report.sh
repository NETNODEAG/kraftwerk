#!/usr/bin/env bash
# Renders report.html from audit.json using the workflow template.
# Fully deterministic — every slot is computed here.
set -u

TEMPLATE="$WORKFLOW_DIR/templates/report.html" python3 <<'PY'
import json, os, re, html
from urllib.parse import urlsplit

a = json.load(open("audit.json"))
tpl = open(os.environ["TEMPLATE"], errors="replace").read()
tpl = re.sub(r"<!--\s*\n?\s*SLOT DOCUMENTATION.*?-->\n?", "", tpl, flags=re.S)

esc = html.escape
BADGE = {"ok": "pass", "warning": "warning", "critical": "fail"}

cards = []
for c in a["checks"]:
    details = "".join("<li>%s</li>" % esc(d) for d in c["details"])
    parts = [
        '<section class="card check %s">' % c["status"],
        '<div class="check-head">',
        '<span class="badge %s">%s</span>' % (c["status"], BADGE[c["status"]]),
        "<h2>%s</h2>" % esc(c["label"]),
        '<span class="check-sum">%s</span>' % esc(c["summary"]),
        "</div>",
    ]
    if details:
        parts.append('<ul class="check-details">%s</ul>' % details)
    if c["evidence"]:
        parts.append('<pre class="evidence">%s</pre>' % esc("\n".join(c["evidence"])))
    parts.append("</section>")
    cards.append("".join(parts))

# ---- fix prompt from all non-passing checks ----
findings = [c for c in a["checks"] if c["status"] != "ok"]
fix_prompt = ""
if findings:
    lines = [
        "Fix the following issues found by an automated website audit.",
        "Audited URL: %s" % a["url"],
    ]
    if a["final_url"].rstrip("/") != a["url"].rstrip("/"):
        lines.append("Final URL after redirects: %s" % a["final_url"])
    lines.append("")
    for i, c in enumerate(findings, 1):
        sev = {"warning": "Warning", "critical": "Critical"}[c["status"]]
        lines.append("## Issue %d — %s (%s): %s" % (i, c["label"], sev, c["summary"]))
        for d in c["details"]:
            lines.append("- %s" % d)
        if c["evidence"]:
            lines.append("Evidence:")
            lines.append("```")
            lines.extend(c["evidence"])
            lines.append("```")
        lines.append("")
    lines += [
        "Locate where each of these is produced in this codebase (HTML templates, "
        "layout components, meta/SEO config, server or redirect config) and fix "
        "every issue. Keep changes minimal and consistent with the existing code "
        "style. Do not change anything unrelated to these findings. When done, "
        "list each issue and what you changed to resolve it.",
    ]
    fix_prompt = "\n".join(lines)
    open("fix_prompt.txt", "w").write(fix_prompt + "\n")

if fix_prompt:
    n = len(findings)
    fix_section = """<section class="card fix">
    <div class="fix-head">
      <div>
        <h2>Fix prompt</h2>
        <div class="fix-sub">%d finding%s — paste this into a coding agent running on the website's codebase</div>
      </div>
      <button id="copy-fix" type="button">Copy prompt</button>
    </div>
    <pre id="fix-prompt">%s</pre>
  </section>
  <script>
  (function () {
    var btn = document.getElementById("copy-fix");
    var pre = document.getElementById("fix-prompt");
    btn.addEventListener("click", function () {
      var text = pre.textContent;
      function done() {
        btn.classList.add("done"); btn.textContent = "Copied ✓";
        setTimeout(function () { btn.classList.remove("done"); btn.textContent = "Copy prompt"; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  })();
  </script>""" % (n, "s" if n != 1 else "", esc(fix_prompt))
else:
    fix_section = ""

score, fetch = a["score"], a["fetch"]
issues = score["warning"] + score["critical"]
if a["overall"] == "ok":
    label = "all checks passed"
elif score["critical"]:
    label = "%d check%s failed" % (score["critical"], "s" if score["critical"] != 1 else "")
else:
    label = "%d warning%s" % (score["warning"], "s" if score["warning"] != 1 else "")

host = urlsplit(a["final_url"]).netloc or a["url"]
url_line = a["url"]
if a["final_url"].rstrip("/") != a["url"].rstrip("/"):
    url_line += "  →  " + a["final_url"]

size = fetch["size_bytes"]
size_v = "%.1f MB" % (size / 1e6) if size >= 1e6 else "%.0f kB" % (size / 1e3)

slots = {
    "SITE": esc(host),
    "URL_LINE": esc(url_line),
    "GENERATED_AT": esc(a["generated_at"]),
    "STATUS_CLASS": a["overall"],
    "STATUS_LABEL": esc(label),
    "PASS_VALUE": str(score["ok"]),
    "WARN_VALUE": str(score["warning"]),
    "FAIL_VALUE": str(score["critical"]),
    "HTTP_VALUE": str(fetch["final_status"] or "—"),
    "HTTP_SUB": "%d redirect%s" % (fetch["redirects"], "s" if fetch["redirects"] != 1 else ""),
    "TIME_VALUE": "%.2f s" % fetch["total_s"],
    "TIME_SUB": "TTFB %.2f s" % fetch["ttfb_s"],
    "SIZE_VALUE": size_v,
    "SIZE_SUB": esc(fetch["content_type"].split(";")[0] or "unknown type"),
    "CHECK_CARDS": "\n  ".join(cards),
    "FIX_SECTION": fix_section,
}
for k, v in slots.items():
    tpl = tpl.replace("{{%s}}" % k, v)

left = re.findall(r"\{\{[A-Z_]+\}\}", tpl)
if left:
    raise SystemExit("unfilled slots: %s" % ", ".join(sorted(set(left))))
open("report.html", "w").write(tpl)
PY
[ -s report.html ] || { echo "report.html not produced" >&2; exit 1; }

cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["report.html"], "summary": "HTML report rendered from audit.json"}
\`\`\`
EOF
