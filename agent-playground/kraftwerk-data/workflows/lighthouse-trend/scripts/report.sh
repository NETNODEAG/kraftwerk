#!/usr/bin/env bash
# report.md and summary.txt from scores.json plus the history CSVs. No LLM.
set -u
python3 <<'PY'
import json, csv, os
d = json.load(open("scores.json"))
L = ["# Lighthouse trend", "", f"Measured {d['at']} UTC (mobile emulation, Lighthouse defaults).", "", "## Scores", "",
     "| URL | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |", "|---|---|---|---|---|---|---|---|"]
def delta(cur, prev, key, unit=""):
    if prev is None: return f"{cur}{unit}"
    diff = cur - prev
    arrow = "" if diff == 0 else (" ↑" if diff > 0 else " ↓")
    shown = abs(round(diff, 3)) if unit == "" and key == "cls" else abs(round(diff))
    return f"{cur}{unit}{arrow}{shown if diff else ''}"
summ = []
histories = []
for r in d["results"]:
    if "error" in r: L.append(f"| {r['url']} | failed | | | | | | |"); summ.append(f"{r['url']}: failed"); continue
    rows = list(csv.DictReader(open(r["history_file"])))
    prev = rows[-2] if len(rows) >= 2 else None
    P = lambda k: (float(prev[k]) if prev else None)
    L.append(f"| {r['url']} | {delta(r['performance'], P('performance'), 'performance')} | {delta(r['accessibility'], P('accessibility'), 'accessibility')} | {delta(r['best_practices'], P('best_practices'), 'best_practices')} | {delta(r['seo'], P('seo'), 'seo')} | {delta(r['lcp_ms'], P('lcp_ms'), 'lcp_ms', ' ms')} | {delta(r['cls'], P('cls'), 'cls')} | {delta(r['tbt_ms'], P('tbt_ms'), 'tbt_ms', ' ms')} |")
    ch = f" ({'+' if r['performance'] - P('performance') >= 0 else ''}{round(r['performance'] - P('performance'))})" if prev else " (first run)"
    warn = " ⚠ unreliable" if r.get("warnings") else ""
    summ.append(f"{r['url']}: perf {r['performance']}{ch}, LCP {r['lcp_ms']} ms{warn}")
    histories.append((r["url"], rows[-10:]))
warned = [r for r in d["results"] if r.get("warnings")]
if warned:
    L += ["", "## Warnings", "", "Lighthouse flagged these runs; treat their timings as unreliable (a busy or slow machine, a page that did not finish loading):", ""]
    for r in warned: L += [f"- {r['url']}"] + [f"  - {w}" for w in r["warnings"]]
L += ["", "## History", "", "A ⚠ marks a run Lighthouse flagged as unreliable.", ""]
for url, rows in histories:
    L += [f"### {url}", "", "| When | Perf | A11y | BP | SEO | LCP | CLS | TBT |", "|---|---|---|---|---|---|---|---|"]
    for h in rows: L.append(f"| {h['at']}{' ⚠' if h.get('warned') == '1' else ''} | {h['performance']} | {h['accessibility']} | {h['best_practices']} | {h['seo']} | {h['lcp_ms']} ms | {h['cls']} | {h['tbt_ms']} ms |")
    L.append("")
if not histories: L.append("No history yet.")
verdict = "; ".join(summ)
L += ["", f"**Summary:** {verdict}", ""]
open("report.md", "w").write("\n".join(L)); open("summary.txt", "w").write(verdict + "\n"); print(verdict)
PY
