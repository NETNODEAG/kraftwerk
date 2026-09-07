#!/usr/bin/env bash
# report.md and summary.txt from results.json. Deterministic, no LLM.
set -u
python3 <<'PY'
import json
d = json.load(open("results.json"))
L = ["# TLS and security headers", "", f"Checked {d['checked_at'][:16].replace('T', ' ')} UTC.", "", "## Domains", "",
     "| Domain | Expires | Issuer | Chain | http→https | HSTS | CSP | Frame | Nosniff | Referrer |", "|---|---|---|---|---|---|---|---|---|---|"]
yes = lambda v: "yes" if v else "no"
def issuer(v):
    # "C=US, O=Google Trust Services, CN=WR1" -> the organisation, else the CN
    if not v: return "—"
    parts = dict(kv.strip().split("=", 1) for kv in v.split(",") if "=" in kv)
    return parts.get("O") or parts.get("CN") or v
for r in d["domains"]:
    exp = f"{r['days_left']} d" if r["days_left"] is not None else "—"
    frame = "yes" if r["x_frame_options"] or (r["csp"] and "frame-ancestors" in r["csp"]) else "no"
    L.append(f"| {r['domain']} | {exp} | {issuer(r['issuer'])} | {r['chain']} | {yes(r['redirects_to_https'])} | {yes(r['hsts'])} | {yes(r['csp'])} | {frame} | {yes(r['x_content_type_options'])} | {yes(r['referrer_policy'])} |")
L += ["", "## Findings", ""]
total = 0
for r in d["domains"]:
    if r["findings"]:
        L.append(f"### {r['domain']}")
        L += [f"- {f}" for f in r["findings"]] + [""]
        total += len(r["findings"])
if not total: L.append("Nothing to fix.")
soon = [r["domain"] for r in d["domains"] if r["days_left"] is not None and r["days_left"] < 30]
verdict = f"{total} finding(s) across {len(d['domains'])} domain(s)" + (f", certificate expiring soon: {', '.join(soon)}" if soon else "")
L += ["", f"**Verdict:** {verdict}.", ""]
open("report.md", "w").write("\n".join(L)); open("summary.txt", "w").write(verdict + "\n"); print(verdict)
PY
