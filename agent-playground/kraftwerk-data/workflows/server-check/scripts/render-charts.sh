set -euo pipefail

# Fill the four chart slots (columns + subtitle) in report.html
# deterministically from chart_data.tsv — a 24h series is far too many
# data points for the LLM step to render reliably.
python3 - <<'PY'
html = open('report.html').read()

series = {}
try:
    for line in open('chart_data.tsv'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) != 3:
            continue
        metric, t, v = parts
        try:
            fv = float(v)
        except ValueError:
            continue
        series.setdefault(metric, []).append((t, v, fv))
except FileNotFoundError:
    pass

slots = {'load': 'LOAD', 'cpu': 'CPU', 'mem': 'MEM', 'net': 'NET'}
counts = {}
for metric, slot in slots.items():
    pts = series.get(metric, [])
    counts[metric] = len(pts)
    if not pts:
        html = html.replace('{{%s_COLS}}' % slot, '')
        html = html.replace('{{%s_TICKS}}' % slot, '')
        html = html.replace('{{%s_CHART_SUB}}' % slot, 'no sysstat data available')
        continue
    mx = max(p[2] for p in pts) or 1.0
    peak = max(range(len(pts)), key=lambda i: pts[i][2])
    avg = sum(p[2] for p in pts) / len(pts)
    cols = []
    for i, (t, v, fv) in enumerate(pts):
        h = round(fv / mx * 100)
        if i == peak:
            cols.append(f'<div class="col peak" style="--v:{h}" title="{t} · {v}" data-v="{v}"></div>')
        else:
            cols.append(f'<div class="col" style="--v:{h}" title="{t} · {v}"></div>')
    sub = f'{len(pts)} samples · peak {pts[peak][1]} at {pts[peak][0]} · avg {avg:.1f}'
    # Time axis: a tick + exact time label at every half hour. Labels are
    # rotated 45°; skip the last few percent so the final label can't
    # overflow the card.
    ticks = []
    for i, (t, v, fv) in enumerate(pts):
        if t[-2:] in ('00', '30'):
            x = round((i + 0.5) / len(pts) * 100, 2)
            ticks.append(f'<i style="--x:{x}"></i>')
            if 2 <= x <= 97:
                ticks.append(f'<span style="--x:{x}">{t}</span>')
    html = html.replace('{{%s_COLS}}' % slot, ''.join(cols))
    html = html.replace('{{%s_TICKS}}' % slot, ''.join(ticks))
    html = html.replace('{{%s_CHART_SUB}}' % slot, sub)

open('report.html', 'w').write(html)
print('charts rendered:', counts)
PY
