#!/usr/bin/env bash
# Certificate (openssl), HTTPS redirect and response headers (curl) per
# domain. Deterministic, no LLM. Writes probes/<domain>-*.txt and results.json.
set -u
# Domains from the request: "a.ch b.ch, https://c.ch/x" -> a.ch b.ch c.ch
domains_from_request() {
  echo "$REQUEST" | tr ',;' '  ' | tr -s ' ' '\n' | sed -e 's#^https\?://##' -e 's#/.*##' | grep -v '^$' | awk '!seen[$0]++'
}

mkdir -p probes
: > domains.txt
domains_from_request > domains.txt
[ -s domains.txt ] || { echo "request must name at least one domain" >&2; exit 2; }

while read -r d; do
  # certificate: leaf dates, issuer, subject alt names, chain verification
  # stdin closed by the echo, so s_client exits right after the handshake (no `timeout` on macOS)
  echo | openssl s_client -connect "$d:443" -servername "$d" -showcerts > "probes/$d-tls.txt" 2>&1
  openssl x509 -noout -dates -issuer -subject -ext subjectAltName < "probes/$d-tls.txt" > "probes/$d-cert.txt" 2>/dev/null
  # plain http: does it redirect to https?
  curl -s -o /dev/null --max-time 15 -w '%{http_code}\t%{redirect_url}\n' "http://$d/" > "probes/$d-http.txt" 2>&1
  # https response headers (follow to the final page)
  curl -s -o /dev/null --max-time 20 -L --max-redirs 5 -D "probes/$d-headers.txt" -w '%{http_code}\t%{url_effective}\n' "https://$d/" > "probes/$d-https.txt" 2>&1
done < domains.txt

python3 <<'PY'
import json, re, datetime, os
out = []
now = datetime.datetime.now(datetime.timezone.utc)
for d in open("domains.txt").read().split():
    r = {"domain": d, "findings": []}
    tls = open(f"probes/{d}-tls.txt", errors="replace").read()
    cert = open(f"probes/{d}-cert.txt", errors="replace").read() if os.path.exists(f"probes/{d}-cert.txt") else ""
    m = re.search(r"notAfter=(.+)", cert)
    if m:
        exp = datetime.datetime.strptime(m.group(1).strip(), "%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc)
        r["not_after"] = exp.isoformat(); r["days_left"] = (exp - now).days
    else:
        r["not_after"] = None; r["days_left"] = None; r["findings"].append("no certificate could be read on :443")
    mi = re.search(r"issuer=(.+)", cert); r["issuer"] = mi.group(1).strip() if mi else None
    mv = re.search(r"Verify return code: (\d+) \((.+?)\)", tls); r["chain"] = mv.group(2) if mv else "unknown"
    sans = re.findall(r"DNS:([^,\s]+)", cert); r["covers_domain"] = any(s == d or (s.startswith("*.") and d.endswith(s[1:])) for s in sans)
    http = open(f"probes/{d}-http.txt").read().strip().split("\t") if os.path.exists(f"probes/{d}-http.txt") else ["000", ""]
    r["http_status"] = http[0]; r["http_redirect"] = http[1] if len(http) > 1 else ""
    r["redirects_to_https"] = r["http_redirect"].startswith("https://")
    hdr = open(f"probes/{d}-headers.txt", errors="replace").read().lower() if os.path.exists(f"probes/{d}-headers.txt") else ""
    def h(name):
        m = re.search(r"^" + re.escape(name) + r":\s*(.+)$", hdr, re.M); return m.group(1).strip() if m else None
    r["hsts"] = h("strict-transport-security"); r["csp"] = h("content-security-policy"); r["x_frame_options"] = h("x-frame-options")
    r["x_content_type_options"] = h("x-content-type-options"); r["referrer_policy"] = h("referrer-policy"); r["permissions_policy"] = h("permissions-policy")
    https = open(f"probes/{d}-https.txt").read().strip().split("\t") if os.path.exists(f"probes/{d}-https.txt") else ["000", ""]
    r["https_status"] = https[0]; r["final_url"] = https[1] if len(https) > 1 else ""
    # findings
    if r["days_left"] is not None and r["days_left"] < 30: r["findings"].append(f"certificate expires in {r['days_left']} days")
    if r["chain"] not in ("ok", "unknown"): r["findings"].append(f"chain does not verify: {r['chain']}")
    if sans and not r["covers_domain"]: r["findings"].append("certificate does not cover the domain")
    if not r["redirects_to_https"]: r["findings"].append("http:// does not redirect to https://")
    if not r["hsts"]: r["findings"].append("no Strict-Transport-Security header")
    if not r["csp"]: r["findings"].append("no Content-Security-Policy header")
    if not r["x_frame_options"] and not (r["csp"] and "frame-ancestors" in r["csp"]): r["findings"].append("no clickjacking protection (X-Frame-Options or CSP frame-ancestors)")
    if not r["x_content_type_options"]: r["findings"].append("no X-Content-Type-Options header")
    if not r["referrer_policy"]: r["findings"].append("no Referrer-Policy header")
    out.append(r)
json.dump({"checked_at": now.isoformat(), "domains": out}, open("results.json", "w"), indent=2)
print(f"{len(out)} domain(s) inspected")
PY
