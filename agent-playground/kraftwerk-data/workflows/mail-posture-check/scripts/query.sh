#!/usr/bin/env bash
# MX, SPF (TXT), DMARC (_dmarc TXT) and DKIM (common selectors) per domain
# with dig. Deterministic, no LLM. Writes probes/ and results.json.
set -u
# Domains from the request: "a.ch b.ch, https://c.ch/x" -> a.ch b.ch c.ch
domains_from_request() {
  echo "$REQUEST" | tr ',;' '  ' | tr -s ' ' '\n' | sed -e 's#^https\?://##' -e 's#/.*##' | grep -v '^$' | awk '!seen[$0]++'
}

command -v dig >/dev/null 2>&1 || { echo "dig is not installed" >&2; exit 2; }
domains_from_request > domains.txt
[ -s domains.txt ] || { echo "request must name at least one domain" >&2; exit 2; }
SELECTORS="google selector1 selector2 default k1 k2 k3 mail dkim s1 s2 sig1 mandrill cm zoho mailjet pm protonmail fm1 fm2 fm3 everlytic smtp mta krs mimecast20200401 sendgrid mg"
mkdir -p probes
# +short answers only (a ";;" line is a transport error, not data); a lost
# UDP reply is asked again over TCP, like dns-check does.
q() {
  local out; out=$(dig +time=3 +tries=1 +short "$@" 2>/dev/null)
  case "$out" in *";;"*) out=$(dig +tcp +time=5 +tries=1 +short "$@" 2>/dev/null);; esac
  printf '%s\n' "$out" | grep -v '^;;' | grep -v '^$'
}
while read -r d; do
  q "$d" MX > "probes/$d-mx.txt"
  q "$d" TXT > "probes/$d-txt.txt"
  q "_dmarc.$d" TXT > "probes/$d-dmarc.txt"
  : > "probes/$d-dkim.txt"
  for s in $SELECTORS; do
    r=$(q "$s._domainkey.$d" TXT | tr -d '"' | tr -d '\n')
    case "$r" in *v=DKIM1*|*k=rsa*|*p=*) echo "$s" >> "probes/$d-dkim.txt";; esac
  done
  sleep 0.2
done < domains.txt

python3 <<'PY'
import json, re, datetime
out = []
for d in open("domains.txt").read().split():
    r = {"domain": d, "findings": []}
    mx = [l.split()[-1].rstrip(".") for l in open(f"probes/{d}-mx.txt").read().splitlines() if l.strip()]
    r["mx"] = sorted(mx)
    txt = [l.strip().strip('"').replace('" "', "") for l in open(f"probes/{d}-txt.txt").read().splitlines()]
    spf = [t for t in txt if t.lower().startswith("v=spf1")]
    r["spf"] = spf[0] if spf else None
    r["spf_all"] = (re.search(r"([-~+?])all", spf[0]) or [None, None])[1] if spf else None
    dm = [l.strip().strip('"').replace('" "', "") for l in open(f"probes/{d}-dmarc.txt").read().splitlines() if "DMARC1" in l]
    r["dmarc"] = dm[0] if dm else None
    tags = dict(kv.strip().split("=", 1) for kv in dm[0].split(";") if "=" in kv) if dm else {}
    r["dmarc_policy"] = tags.get("p"); r["dmarc_rua"] = tags.get("rua"); r["dmarc_pct"] = tags.get("pct", "100") if dm else None
    r["dkim"] = open(f"probes/{d}-dkim.txt").read().split()
    if not mx: r["findings"].append("no MX record — the domain does not receive mail (fine for a web-only domain, then SPF should be v=spf1 -all)")
    if not spf: r["findings"].append("no SPF record")
    elif len(spf) > 1: r["findings"].append("more than one SPF record (receivers treat that as a permanent error)")
    elif r["spf_all"] in ("+", "?"): r["findings"].append(f"SPF ends with {r['spf_all']}all — effectively no protection")
    if not dm: r["findings"].append("no DMARC record")
    else:
        if r["dmarc_policy"] == "none": r["findings"].append("DMARC policy is none — monitoring only, spoofed mail is still delivered")
        if not r["dmarc_rua"]: r["findings"].append("DMARC has no rua= reporting address — nobody sees the reports")
    if mx and not r["dkim"]: r["findings"].append("no DKIM selector found among the common ones (the sender may use a custom selector)")
    out.append(r)
json.dump({"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "domains": out}, open("results.json", "w"), indent=2)
print(f"{len(out)} domain(s) queried")
PY
