set -euo pipefail

server="$(tr -d '[:space:]' < target.txt)"
[ -n "$server" ] || { echo "target.txt is empty — no server extracted" >&2; exit 1; }

echo "Collecting stats from root@${server} ..."

{
  echo "server: ${server}"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "root@${server}" bash -s <<'REMOTE'
echo "uptime: $(uptime -p)"
echo "cpu_count: $(nproc)"
read l1 l5 l15 _ < /proc/loadavg
echo "load_1m: $l1"
echo "load_5m: $l5"
echo "load_15m: $l15"
echo "memory: $(free -m | awk '/^Mem:/ {printf "%d/%d MB (%.0f%%)\n", $3, $2, $3/$2*100}')"
echo "swap: $(free -m | awk '/^Swap:/ {if ($2==0) print "none"; else printf "%d/%d MB (%.0f%%)\n", $3, $2, $3/$2*100}')"
echo "disk_root: $(df -h / | awk 'NR==2 {print $5" used ("$3"/"$2")"}')"
echo "processes: $(ps -e --no-headers | wc -l | tr -d ' ')"
echo "last_boot: $(who -b | awk '{print $3, $4}')"
echo "filesystems: |"
df -h -x tmpfs -x devtmpfs -x overlay 2>/dev/null | sed 's/^/  /'
echo "top_cpu_processes: |"
ps -eo pcpu,pmem,comm --sort=-pcpu --no-headers | awk '$3!="ps"' | head -5 | sed 's/^/  /'
echo "top_mem_processes: |"
ps -eo pmem,pcpu,comm --sort=-pmem --no-headers | head -5 | sed 's/^/  /'
echo "top_disk_consumers_root: |"
du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -8 | sed 's/^/  /'
j="$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+ ?[KMGTP]i?B?' | tail -1)"
echo "journal_disk_usage: ${j:-unknown}"

# --- sysstat: trends (hourly aggregates of today's 10-min samples) ---
if command -v sar >/dev/null 2>&1; then
  echo "cpu_today_hourly: |"
  sar -u 2>/dev/null | awk '
    $2=="all" && $1 ~ /^[0-9]{2}:/ {h=substr($1,1,2); u[h]+=$3; s[h]+=$5; io[h]+=$6; st[h]+=$7; n[h]++}
    END {for (h in n) printf "  %s:00 user %.1f%% sys %.1f%% iowait %.1f%% steal %.1f%%\n", h, u[h]/n[h], s[h]/n[h], io[h]/n[h], st[h]/n[h]}' | sort

  echo "load_today_hourly: |"
  sar -q 2>/dev/null | awk '
    $1 ~ /^[0-9]{2}:/ && $4 ~ /^[0-9.]+$/ {h=substr($1,1,2); l1[h]+=$4; l15[h]+=$6; n[h]++}
    END {for (h in n) printf "  %s:00 ldavg-1 %.2f ldavg-15 %.2f\n", h, l1[h]/n[h], l15[h]/n[h]}' | sort

  echo "memory_today_hourly: |"
  sar -r 2>/dev/null | awk '
    /%memused/ && !c {for(i=1;i<=NF;i++) if ($i=="%memused") c=i; next}
    c && $1 ~ /^[0-9]{2}:/ && $c ~ /^[0-9.]+$/ {h=substr($1,1,2); m[h]+=$c; n[h]++}
    END {for (h in n) printf "  %s:00 memused %.1f%%\n", h, m[h]/n[h]}' | sort

  echo "network_today_hourly: |"
  sar -n DEV 2>/dev/null | awk '
    $1 ~ /^[0-9]{2}:/ && $2 !~ /^(lo$|veth|br-|docker)/ && $5 ~ /^[0-9.]+$/ {
      h=substr($1,1,2); rx[h]+=$5; tx[h]+=$6; if ($1!=prev[h]) {cnt[h]++; prev[h]=$1}}
    END {for (h in cnt) printf "  %s:00 rx %.0f kB/s tx %.0f kB/s\n", h, rx[h]/cnt[h], tx[h]/cnt[h]}' | sort

  # --- pre-reboot forensics: load + memory in the 90 min before last boot ---
  boot_str="$(who -b | awk '{print $3, $4}')"
  boot_epoch="$(date -d "$boot_str" +%s 2>/dev/null || echo "")"
  now_epoch="$(date +%s)"
  if [ -n "$boot_epoch" ] && [ $((now_epoch - boot_epoch)) -lt 604800 ]; then
    midnight_epoch="$(date -d "$(date -d "@$boot_epoch" +%Y-%m-%d) 00:00:00" +%s)"
    start_epoch=$((boot_epoch - 5400))
    [ "$start_epoch" -lt "$midnight_epoch" ] && start_epoch=$((midnight_epoch + 60))
    boot_day="$(date -d "@$boot_epoch" +%d)"
    boot_time="$(date -d "@$boot_epoch" +%H:%M:%S)"
    start_time="$(date -d "@$start_epoch" +%H:%M:%S)"
    safile="/var/log/sysstat/sa${boot_day}"
    [ -f "$safile" ] || safile="/var/log/sa/sa${boot_day}"
    if [ -f "$safile" ]; then
      echo "pre_reboot_load: |"
      sar -q -f "$safile" -s "$start_time" -e "$boot_time" 2>/dev/null | tail -12 | sed 's/^/  /'
      echo "pre_reboot_memory: |"
      sar -r -f "$safile" -s "$start_time" -e "$boot_time" 2>/dev/null | tail -12 | sed 's/^/  /'
    fi
  fi
fi

# --- real-device I/O (since boot) ---
if command -v iostat >/dev/null 2>&1; then
  echo "disk_io: |"
  iostat -x -d 2>/dev/null | awk '$1 ~ /^(sd|nvme|vd|xvd)/ {
    printf "  %s r/s %.1f w/s %.1f rkB/s %.0f wkB/s %.0f await(r/w) %.1f/%.1f ms util %.1f%%\n", $1,$2,$8,$3,$9,$6,$12,$NF}'
fi

# --- top I/O processes (5s sample) ---
if command -v pidstat >/dev/null 2>&1; then
  echo "top_io_processes: |"
  pidstat -d 5 1 2>/dev/null | awk '$1=="Average:" && $4 ~ /^[0-9.]+$/' \
    | sort -k5 -rn | head -5 \
    | awk '{cmd=""; for(i=8;i<=NF;i++) cmd=cmd" "$i; printf "  rd %s kB/s wr %s kB/s%s\n", $4, $5, cmd}'
fi

# --- last-24h chart series at native sample resolution (goes to chart_data.tsv) ---
if command -v sar >/dev/null 2>&1; then
  now_t="$(date +%H:%M:%S)"
  ysa="/var/log/sysstat/sa$(date -d yesterday +%d)"
  [ -f "$ysa" ] || ysa="/var/log/sa/sa$(date -d yesterday +%d)"

  emit_load() { sar -q "$@" 2>/dev/null | awk '
    $1 ~ /^[0-9]{2}:/ && $4 ~ /^[0-9.]+$/ {print "load\t" substr($1,1,5) "\t" $4}'; }
  emit_cpu() { sar -u "$@" 2>/dev/null | awk '
    $2=="all" && $1 ~ /^[0-9]{2}:/ {printf "cpu\t%s\t%.1f\n", substr($1,1,5), 100-$NF}'; }
  emit_mem() { sar -r "$@" 2>/dev/null | awk '
    /%memused/ && !c {for(i=1;i<=NF;i++) if ($i=="%memused") c=i; next}
    c && $1 ~ /^[0-9]{2}:/ && $c ~ /^[0-9.]+$/ {print "mem\t" substr($1,1,5) "\t" $c}'; }
  emit_net() { sar -n DEV "$@" 2>/dev/null | awk '
    $1 ~ /^[0-9]{2}:/ && $2 !~ /^(lo$|veth|br-|docker)/ && $5 ~ /^[0-9.]+$/ {
      t=substr($1,1,5); if (!(t in seen)) {seen[t]=1; ord[++n]=t} kb[t]+=$5+$6}
    END {for(i=1;i<=n;i++) printf "net\t%s\t%.0f\n", ord[i], kb[ord[i]]}'; }

  echo "last24h_extremes: |"
  for metric in load cpu mem net; do
    { [ -f "$ysa" ] && "emit_${metric}" -f "$ysa" -s "$now_t" -e 23:59:59; "emit_${metric}" -e 23:59:59; } \
      | awk -F'\t' -v m="$metric" '{s+=$3; n++; if ($3+0>mx) {mx=$3+0; mv=$3; mt=$2}}
          END {if (n) printf "  %s: avg %.1f, peak %s at %s\n", m, s/n, mv, mt}'
  done

  echo "===CHART_DATA==="
  for metric in load cpu mem net; do
    [ -f "$ysa" ] && "emit_${metric}" -f "$ysa" -s "$now_t" -e 23:59:59
    "emit_${metric}" -e 23:59:59
  done
fi
REMOTE
} | awk '
  /^===CHART_DATA===$/ {out=1; next}
  out {print > "chart_data.tsv"; next}
  {print > "server_state.yml"}' || {
  echo "SSH to root@${server} failed — check key auth (BatchMode) and host reachability" >&2
  exit 1
}
touch chart_data.tsv

echo "server_state.yml written for ${server}"
