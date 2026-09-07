#!/usr/bin/env bash
# report.md and summary.txt from results.json. Deterministic, no LLM.
set -u
python3 <<'PY'
import json
d = json.load(open("results.json"))
L = ["# Mail posture", "", f"Checked {d['checked_at'][:16].replace('T', ' ')} UTC.", "", "## Domains", "",
     "| Domain | MX | SPF | DMARC | Reports | DKIM selectors |", "|---|---|---|---|---|---|"]
for r in d["domains"]:
    spf = f"yes ({r['spf_all']}all)" if r["spf"] else "no"
    dm = f"p={r['dmarc_policy']}" if r["dmarc"] else "no"
    L.append(f"| {r['domain']} | {', '.join(r['mx']) or '—'} | {spf} | {dm} | {'yes' if r['dmarc_rua'] else 'no'} | {', '.join(r['dkim']) or '—'} |")
L += ["", "## Findings", ""]
total = 0
for r in d["domains"]:
    if r["findings"]:
        L.append(f"### {r['domain']}"); L += [f"- {f}" for f in r["findings"]] + [""]; total += len(r["findings"])
if not total: L.append("Nothing to fix.")
verdict = f"{total} finding(s) across {len(d['domains'])} domain(s)"
L += ["", f"**Verdict:** {verdict}.", ""]
open("report.md", "w").write("\n".join(L)); open("summary.txt", "w").write(verdict + "\n"); print(verdict)
PY
