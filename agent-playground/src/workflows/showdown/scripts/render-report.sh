#!/usr/bin/env bash
# Phase "render scoreboard": drafts + reviews + verdict.json + trace.jsonl
# -> showdown.html. Fully deterministic; every slot computed here.
set -u

TEMPLATE="$WORKFLOW_DIR/templates/report.html" python3 <<'PY'
import json, os, re, html, datetime

run_dir = os.environ["RUN_DIR"]
tpl = open(os.environ["TEMPLATE"], errors="replace").read()
tpl = re.sub(r"<!--\s*\n?\s*SLOT DOCUMENTATION.*?-->\n?", "", tpl, flags=re.S)

def esc(s):
    # slots_filled fails on any literal "{{" — escape it in content.
    return html.escape(str(s)).replace("{{", "&#123;&#123;")

def load(name):
    with open(os.path.join(run_dir, name)) as f:
        return json.load(f)

verdict = load("verdict.json")
CRITERIA = ["brief_fit", "clarity", "craft", "punch"]
LABELS = {"brief_fit": "brief fit", "clarity": "clarity",
          "craft": "craft", "punch": "punch"}

# ---- tiny markdown -> html for the drafts ----------------------------------
def md_html(text):
    out, in_list = [], False
    for raw in text.splitlines():
        line = raw.strip()
        def inline(s):
            s = esc(s)
            s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
            s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", s)
            s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
            return s
        if line.startswith("- ") or line.startswith("* "):
            if not in_list:
                out.append("<ul>"); in_list = True
            out.append(f"<li>{inline(line[2:])}</li>")
            continue
        if in_list:
            out.append("</ul>"); in_list = False
        if line.startswith("## "):
            out.append(f"<h2>{inline(line[3:])}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{inline(line[2:])}</h1>")
        elif line:
            out.append(f"<p>{inline(line)}</p>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out)

# ---- one contestant column --------------------------------------------------
def card(who):
    rival = "codex" if who == "claude" else "claude"
    draft = open(os.path.join(run_dir, f"draft-{who}.md"), errors="replace").read()
    review = load(f"review-by-{rival}.json")  # the RIVAL scored this draft
    total = verdict["totals"][who]
    words = verdict["word_counts"][who]

    crits = []
    for c in CRITERIA:
        s = review.get("scores", {}).get(c, {})
        pts = s.get("points", 0)
        note = s.get("note", "")
        crits.append(
            f'<div class="crit"><div class="row">'
            f'<span class="name">{LABELS[c]}</span>'
            f'<span class="bar"><span class="fill" style="width:{pts * 10}%"></span></span>'
            f'<span class="pts">{pts}/10</span></div>'
            + (f'<div class="note">{esc(note)}</div>' if note else "")
            + "</div>"
        )

    best = review.get("best_line", "")
    weak = review.get("weakness", "")
    win = ('<span class="badge win">winner</span>'
           if verdict["winner"] == who else "")
    return (
        f'<section class="card {who}">'
        f'<div class="c-head"><span class="badge {who}">{who}</span>{win}'
        f'<span class="c-model">{esc(MODELS.get(who, ""))}</span></div>'
        f'<div class="draft">{md_html(draft)}</div>'
        f'<div class="wc">{words} words</div>'
        f'<div class="verdict">'
        f'<div class="v-title">Scored by {rival} — {total}/{verdict["max_points"]}</div>'
        + "\n".join(crits)
        + (f'<blockquote class="best">&ldquo;{esc(best)}&rdquo;</blockquote>' if best else "")
        + (f'<div class="weak"><b>Weakness</b> · {esc(weak)}</div>' if weak else "")
        + "</div></section>"
    )

# ---- stats + request from trace.jsonl ---------------------------------------
request, MODELS, stats = "", {}, []
with open(os.path.join(run_dir, "trace.jsonl"), errors="replace") as f:
    for line in f:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("event") == "run_start":
            request = ev.get("request", "")
        if ev.get("event") == "phase_end":
            s = ev.get("stats", {})
            if s.get("kind") == "agent":
                MODELS.setdefault(s.get("agent", ""),
                                  f'{s.get("model", "")} · {s.get("harness", "")}')
                stats.append(s)

def dur(ms):
    sec = ms // 1000
    return f"{sec // 60}m{sec % 60:02d}s" if sec >= 60 else f"{sec}s"

def tok(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)

rows = []
for s in stats:
    cost = f'${s["costUsd"]:.4f}' if s.get("costUsd") else "–"
    rows.append(
        f'<tr><td>{esc(s.get("phase", ""))}</td>'
        f'<td>{esc(s.get("model", ""))}</td>'
        f'<td>{s.get("attempts", 1)}</td>'
        f'<td>{dur(s.get("durationMs", 0))}</td>'
        f'<td>{tok(s.get("inputTokens", 0) + s.get("cacheReadTokens", 0) + s.get("cacheCreationTokens", 0))} / {tok(s.get("outputTokens", 0))}</td>'
        f'<td>{cost}</td></tr>'
    )

winner = verdict["winner"]
loser = "codex" if winner == "claude" else "claude"
if verdict.get("tiebreak") == "brevity":
    sub = (f'Dead heat on points — the shorter draft wins the tiebreak '
           f'({verdict["word_counts"][winner]} vs {verdict["word_counts"][loser]} words).')
elif verdict.get("tiebreak"):
    sub = "Dead heat on points and length — alphabetical tiebreak."
else:
    sub = (f'Wins by {verdict["margin"]} point{"s" if verdict["margin"] != 1 else ""} '
           f'out of {verdict["max_points"]}, as scored by the rival model.')

slots = {
    "BRIEF": esc(request),
    "GENERATED_AT": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    "WINNER_NAME": winner.capitalize(),
    "WINNER_CLASS": winner,
    "WINNER_SCORE": f'{verdict["totals"][winner]} : {verdict["totals"][loser]}',
    "WINNER_SUB": sub,
    "CARD_CLAUDE": card("claude"),
    "CARD_CODEX": card("codex"),
    "STATS_ROWS": "\n".join(rows),
}
out = tpl
for k, v in slots.items():
    out = out.replace("{{%s}}" % k, v)

leftover = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
if leftover:
    raise SystemExit("unfilled slots: " + ", ".join(leftover))

open(os.path.join(run_dir, "showdown.html"), "w").write(out)
print("showdown.html rendered — winner: %s" % winner)
PY
RC=$?

if [ $RC -ne 0 ]; then
  printf '```json\n{"phase":"%s","status":"failed","artifacts":[],"summary":"scoreboard rendering failed"}\n```\n' "$PHASE"
  exit 1
fi

printf '```json\n{"phase":"%s","status":"ok","artifacts":["showdown.html"],"summary":"HTML scoreboard rendered"}\n```\n' "$PHASE"
