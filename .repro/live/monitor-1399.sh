#!/usr/bin/env bash
# Passive long-session precursor monitor for #1399 — for the SLOW-LEAK case
# (crash ~2-3h into normal use with 5-6 opencode terminals).
#
# Run it during your NORMAL kolu-in-Chromium session and just leave it. It does
# ZERO synthetic stress — it only observes, every 30s, appending one JSON line:
#   - discrete W6800 VRAM used / % and gpu_busy
#   - total RSS of Chromium's GPU process(es)  (the thing that leaks)
#   - cumulative Mutter `stack_position` assertions this session
#   - cumulative kernel GPU-fault lines (alerts loudly + records the moment)
# If VRAM or GPU-process RSS climbs steadily over hours and never falls back to
# baseline on idle, that's the leak. Ctrl-C to stop.
#
# Usage:  bash monitor-1399.sh [logfile]      (default ~/k1399-monitor.jsonl)
# Kernel-fault detection needs `dmesg` readable (the dmesg_restrict=0 grant, or
# run with sudo).
set -u
LOG="${1:-$HOME/k1399-monitor.jsonl}"
INT="${INT:-30}"

CARD=""
for c in /sys/class/drm/card*; do
  [ -e "$c/device/uevent" ] || continue
  if grep -qiE '73a3|0000:3d:00.0' "$c/device/uevent"; then CARD="$c/device"; break; fi
done
[ -n "$CARD" ] || for c in /sys/class/drm/card*; do [ -e "$c/device/mem_info_vram_total" ] && { CARD="$c/device"; break; }; done
echo "monitor: card=${CARD:-NONE}  log=$LOG  interval=${INT}s  (Ctrl-C to stop)"

start_epoch=$(date +%s)
rd(){ cat "$CARD/$1" 2>/dev/null; }
prev_faults=0
trap 'echo; echo "stopped. log: $LOG"; exit 0' INT TERM

while :; do
  ts=$(date -Is)
  used=$(rd mem_info_vram_used); total=$(rd mem_info_vram_total); busy=$(rd gpu_busy_percent)
  usedMB=$([ -n "${used:-}" ] && echo $((used/1048576)) || echo null)
  totalMB=$([ -n "${total:-}" ] && echo $((total/1048576)) || echo null)
  pct=null; [ -n "${used:-}" ] && [ -n "${total:-}" ] && pct=$(awk "BEGIN{printf \"%.1f\",100*$used/$total}")
  # sum RSS (KB) of Chromium GPU process(es)
  gpurss=$(ps -eo rss,args 2>/dev/null | awk '/type=gpu-process/ && !/awk/{s+=$1} END{print int(s/1024)}')
  # cumulative Mutter assertions since the monitor started
  mutter=$(journalctl --user --since "@$start_epoch" 2>/dev/null | grep -c 'stack_position' || true)
  # cumulative kernel GPU-fault lines (whole buffer)
  faults=$(dmesg 2>/dev/null | grep -ciE 'page fault|ring .*timeout|gpu reset|MODE1|VRAM is lost|context is lost' || echo 0)
  printf '{"t":"%s","vram_used_mb":%s,"vram_total_mb":%s,"vram_pct":%s,"gpu_busy":%s,"gpu_proc_rss_mb":%s,"mutter_stack_assertions":%s,"kernel_gpu_faults":%s}\n' \
    "$ts" "$usedMB" "$totalMB" "${pct:-null}" "${busy:-null}" "${gpurss:-0}" "${mutter:-0}" "${faults:-0}" | tee -a "$LOG"
  if [ "${faults:-0}" -gt "$prev_faults" ]; then
    echo ">>> KERNEL GPU FAULT(S) DETECTED at $ts — SAVE WORK NOW; a reset may be imminent <<<"
  fi
  prev_faults=${faults:-0}
  sleep "$INT"
done
