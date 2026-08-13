#!/usr/bin/env bash
# Deterministische Messung der fuenf Pruefkriterien. Schreibt messwerte.md
# (rohe Kommando-Ausgaben) und meldet am Ende den Envelope auf stdout.
set -u

URL="$REQUEST"
ORIGIN=$(echo "$URL" | grep -oE 'https?://[^/]+')
HOST=${ORIGIN#*://}
OUT=messwerte.md

HTML=$(curl -sL --max-time 30 "$URL")

{
  echo "# Messwerte"
  echo
  echo "URL: $URL"
  echo
  echo "## HTTPS"
  echo '```'
  curl -sI -o /dev/null --max-time 15 -w "http: %{http_code} -> %{redirect_url}\n" "http://$HOST/" \
    || echo "http-Abruf fehlgeschlagen (curl exit $?)"
  curl -sIL -o /dev/null --max-time 30 -w "final: %{http_code} %{url_effective}\n" "$URL" \
    || echo "https-Abruf fehlgeschlagen (curl exit $?)"
  echo '```'
  echo
  echo "## Security-Header"
  echo '```'
  HEADERS=$(curl -sIL --max-time 30 "$URL" | tr -d '\r' | tr 'A-Z' 'a-z')
  for h in strict-transport-security content-security-policy x-content-type-options x-frame-options referrer-policy permissions-policy; do
    line=$(echo "$HEADERS" | grep -E "^$h:" | head -1)
    echo "${line:-$h: FEHLT}"
  done
  echo '```'
  echo
  echo "## SEO"
  echo '```'
  title=$(echo "$HTML" | grep -o '<title[^>]*>[^<]*</title>' | head -1)
  ttext=$(echo "$title" | sed -E 's/<[^>]+>//g')
  echo "title: ${title:-FEHLT}"
  echo "title-laenge: ${#ttext}"
  desc=$(echo "$HTML" | grep -io '<meta[^>]*name="description"[^>]*>' | head -1)
  dtext=$(echo "$desc" | grep -o 'content="[^"]*"' | head -1 | sed 's/^content="//;s/"$//')
  echo "meta-description: ${desc:-FEHLT}"
  echo "description-laenge: ${#dtext}"
  canonical=$(echo "$HTML" | grep -io '<link[^>]*rel="canonical"[^>]*>' | head -1)
  echo "canonical: ${canonical:-FEHLT}"
  curl -s -o /dev/null --max-time 15 -w "robots.txt: %{http_code}\n" "$ORIGIN/robots.txt"
  curl -s -o /dev/null --max-time 15 -w "sitemap.xml: %{http_code}\n" "$ORIGIN/sitemap.xml"
  echo "img-gesamt: $(echo "$HTML" | grep -o '<img[^>]*>' | grep -c '')"
  echo "img-ohne-alt: $(echo "$HTML" | grep -o '<img[^>]*>' | grep -cv 'alt=')"
  echo '```'
  echo
  echo "## Performance"
  echo '```'
  curl -sL -o /dev/null --max-time 60 -w "ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}B\n" "$URL"
  PERF_HEADERS=$(curl -sIL --max-time 30 -H 'Accept-Encoding: gzip, br, zstd' "$URL" | tr -d '\r')
  enc=$(echo "$PERF_HEADERS" | grep -i '^content-encoding:' | tail -1)
  echo "${enc:-content-encoding: FEHLT}"
  cc=$(echo "$PERF_HEADERS" | grep -i '^cache-control:' | tail -1)
  echo "${cc:-cache-control: FEHLT}"
  echo '```'
  echo
  echo "## Links"
  echo '```'
  echo "$HTML" | grep -o 'href="[^"]*"' | cut -d'"' -f2 \
    | grep -E "^(/|$ORIGIN)" | grep -vE '^(/#|#)' \
    | grep -viE '(/_next/|\.(css|js|mjs|svg|png|jpe?g|webp|ico|woff2?|ttf|xml|json)$)' \
    | sort -u | head -30 \
    | while read -r l; do
        case "$l" in /*) l="$ORIGIN$l";; esac
        code=$(curl -sL -o /dev/null --max-time 15 -w '%{http_code}' "$l")
        echo "$code $l"
      done | sort
  echo '```'
} > "$OUT"

cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["messwerte.md"], "summary": "Fuenf Pruefungen gemessen fuer $URL"}
\`\`\`
EOF
