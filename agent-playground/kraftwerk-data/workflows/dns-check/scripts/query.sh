#!/usr/bin/env bash
# Ask 10 public resolvers on several continents for the domain's A, AAAA,
# NS and MX records with dig. No LLM involved. Writes dig/<resolver>-<type>.txt
# (raw dig output) and answers.json (one entry per resolver and type:
# answers, query time in ms, status).
set -u

DOMAIN="$REQUEST"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
if [ -z "$DOMAIN" ]; then echo "request must be a domain, e.g. example.org" >&2; exit 2; fi
if ! command -v dig >/dev/null 2>&1; then echo "dig is not installed (bind-utils / dnsutils)" >&2; exit 2; fi

# operator|ip|location — anycast networks answer from the nearest site, the
# others from where the operator runs them.
RESOLVERS='
Cloudflare|1.1.1.1|anycast, global
Google|8.8.8.8|anycast, global
Quad9|9.9.9.9|Zürich CH, anycast
OpenDNS|208.67.222.222|San Francisco US, anycast
DNS.WATCH|84.200.69.80|Frankfurt DE
Yandex|77.88.8.8|Moscow RU
AliDNS|223.5.5.5|Hangzhou CN
114DNS|114.114.114.114|Nanjing CN
AdGuard|94.140.14.14|Limassol CY, anycast
Hurricane Electric|74.82.42.42|Fremont US, anycast
'
TYPES="A AAAA NS MX"

mkdir -p dig
: > answers.tsv
echo "$RESOLVERS" | while IFS='|' read -r name ip where; do
  [ -z "$name" ] && continue
  for t in $TYPES; do
    out="dig/${ip}-${t}.txt"
    dig +time=3 +tries=1 +noall +answer +comments +stats "@$ip" "$DOMAIN" "$t" > "$out" 2>&1
    status=$(sed -n 's/^;; ->>HEADER<<-.*status: \([A-Z]*\).*/\1/p' "$out" | head -1)
    if [ -z "$status" ]; then
      # A burst of UDP queries loses packets now and then; every public
      # resolver also answers on TCP, so ask once more that way.
      dig +tcp +time=5 +tries=1 +noall +answer +comments +stats "@$ip" "$DOMAIN" "$t" > "$out" 2>&1
      status=$(sed -n 's/^;; ->>HEADER<<-.*status: \([A-Z]*\).*/\1/p' "$out" | head -1)
    fi
    ms=$(sed -n 's/^;; Query time: \([0-9]*\) msec.*/\1/p' "$out" | head -1)
    [ -z "$status" ] && status="TIMEOUT"
    # answers: the rdata of every answer line for this type (an MX line is
    # "10 mail.example." — one answer), sorted, joined by "|"
    ans=$(awk -v T="$t" '$1 !~ /^;/ && $4 == T { $1=$2=$3=$4=""; sub(/^ +/, ""); print }' "$out" | sort | paste -sd '|' - )
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$ip" "$where" "$t" "$status" "${ms:-}" "$ans" >> answers.tsv
    sleep 0.2  # be a polite client: public resolvers rate-limit bursts
  done
done

DOMAIN="$DOMAIN" python3 <<'PY'
import json, os
rows = []
for line in open("answers.tsv"):
    name, ip, where, t, status, ms, ans = line.rstrip("\n").split("\t")
    rows.append({
        "resolver": name, "ip": ip, "location": where, "type": t,
        "status": status, "ms": int(ms) if ms else None,
        "answers": ans.split("|") if ans else [],
    })
json.dump({"domain": os.environ["DOMAIN"], "types": ["A", "AAAA", "NS", "MX"], "results": rows}, open("answers.json", "w"), indent=2)
print(f"{len(rows)} queries for {os.environ['DOMAIN']} ({len({r['ip'] for r in rows})} resolvers)")
PY
