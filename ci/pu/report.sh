#!/usr/bin/env bash
# Post a CI-metrics comment to a PR: which pool box ran the linux lane, the
# per-recipe + lane-wall timings, and the current pool status.
#
# Sources, all written by a normal `ci/pu/run.sh` invocation:
#   .ci/pu-run.env  — PU_BOX / PU_SHA / PU_START / PU_END / PU_EXIT (the sidecar)
#   .ci/pc.log      — process-compose log; per-node Started/Exited timestamps
#
# Usage:
#   ci/pu/report.sh <pr>                 # read the sidecar, post the comment
#   ci/pu/report.sh <pr> --box kolu-ci-3 # override the box (post-hoc)
#   ci/pu/report.sh <pr> --dry-run       # print the markdown, don't post
#
# Best-effort: a missing pc.log or sidecar degrades the comment, never errors out.
set -uo pipefail

pr="${1:?usage: ci/pu/report.sh <pr> [--box NAME] [--dry-run]}"; shift || true
box_override=""; dry=""
while [ $# -gt 0 ]; do
  case "$1" in
    --box) box_override="${2:-}"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) shift ;;
  esac
done

POOL_SIZE="${KOLU_CI_POOL:-8}"
POOL_PREFIX="${KOLU_CI_POOL_PREFIX:-kolu-ci-}"
LOCK="${KOLU_CI_LOCK:-/tmp/kolu-ci.lease}"
ENV_FILE="${KOLU_CI_RUN_ENV:-.ci/pu-run.env}"
PCLOG="${KOLU_CI_PCLOG:-.ci/pc.log}"

PU_BOX=""; PU_SHA=""; PU_START=""; PU_END=""; PU_EXIT=""; PU_EPHEMERAL=""
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
box="${box_override:-$PU_BOX}"

# pc.log timestamps look like "26-06-06 09:16:11.949" (2-digit year).
to_epoch() { date -d "20$1 $2" +%s 2>/dev/null; }
fmt_dur() { local s="$1"; [ "$s" -ge 60 ] 2>/dev/null && echo "$((s / 60))m$((s % 60))s" || echo "${s}s"; }

# Emit "node<TAB>startDate<TAB>startTime<TAB>exitDate<TAB>exitTime<TAB>code" for
# every process on a platform, parsed from pc.log's Started/Exited lines.
recipe_rows() {
  local plat="@$1"
  [ -f "$PCLOG" ] || return 0
  sed -r 's/\x1b\[[0-9;]*m//g' "$PCLOG" | awk -v plat="$plat" '
    / INF Started / && /process=/ { n=$NF; sub(/^process=/,"",n);
      if (index(n,plat)) { sd[n]=$1; st[n]=$2 } }
    / INF Exited / && /process=/ { n=$NF; sub(/^process=/,"",n);
      if (index(n,plat)) { ed[n]=$1; et[n]=$2;
        for(i=1;i<=NF;i++) if($i ~ /^exit_code=/){c=$i; sub(/exit_code=/,"",c); code[n]=c} } }
    END { for (n in et) printf "%s\t%s\t%s\t%s\t%s\t%s\n", n, sd[n], st[n], ed[n], et[n], code[n] }
  '
}

# Per-recipe table + lane wall for a platform. Echoes the markdown table on
# stdout and the lane wall (seconds) on fd 3.
lane_table() {
  local plat="$1" node sd st ed et code s e dur short minS="" maxE=""
  local -a lines=()
  while IFS=$'\t' read -r node sd st ed et code; do
    [ -n "$node" ] || continue
    s="$(to_epoch "$sd" "$st")"; e="$(to_epoch "$ed" "$et")"
    [ -n "$s" ] && [ -n "$e" ] || continue
    short="${node%@*}"
    [ "$short" = "ci::default" ] && continue   # DAG root, empty body — not a real recipe
    dur=$((e - s))
    lines+=("$dur|$short|${code:-?}")
    { [ -z "$minS" ] || [ "$s" -lt "$minS" ]; } && minS="$s"
    { [ -z "$maxE" ] || [ "$e" -gt "$maxE" ]; } && maxE="$e"
  done < <(recipe_rows "$plat")

  if [ "${#lines[@]}" -eq 0 ]; then echo "_(no per-recipe timing in \`$PCLOG\`)_"; echo 0 >&3; return; fi
  echo "| recipe | duration | |"
  echo "|---|--:|:--|"
  printf '%s\n' "${lines[@]}" | sort -t'|' -k1 -nr | while IFS='|' read -r dur short code; do
    [ "$code" = 0 ] && mark="✓" || mark="✗ (exit $code)"
    printf '| `%s` | %s | %s |\n' "$short" "$(fmt_dur "$dur")" "$mark"
  done
  echo $(( ${maxE:-0} - ${minS:-0} )) >&3
}

# Pool status: each box's location (from one `pu list`) + idle/busy (flock probe,
# run in parallel). Box that just ran this CI shows idle again (lease released).
pool_status() {
  local list tmp; list="$(pu list 2>/dev/null)"; tmp="$(mktemp -d)"
  local i b cfg
  for i in $(seq 1 "$POOL_SIZE"); do
    b="${POOL_PREFIX}${i}"; cfg="$HOME/.pu-state/$b/ssh_config"
    (
      loc="$(awk -F'|' -v b="$b" '{gsub(/^[ \t]+|[ \t]+$/,"",$2)} $2==b {gsub(/ /,"",$3); print $3; exit}' <<<"$list")"
      if [ ! -f "$cfg" ]; then state="— missing"
      else
        out="$(ssh -F "$cfg" -o ConnectTimeout=15 "$b" "flock -n $LOCK -c true && echo IDLE || echo BUSY" 2>/dev/null)"
        case "$out" in IDLE) state="✓ idle";; BUSY) state="🔒 leased";; *) state="✗ unreachable";; esac
      fi
      printf '| `%s` | %s | %s |\n' "$b" "${loc:-?}" "$state" >"$tmp/$i"
    ) &
  done
  wait
  echo "| box | location | state |"; echo "|---|---|---|"
  for i in $(seq 1 "$POOL_SIZE"); do cat "$tmp/$i" 2>/dev/null; done
  rm -rf "$tmp"
}

# ── Build the comment ──
loc="$(pu list 2>/dev/null | awk -F'|' -v b="$box" '{gsub(/^[ \t]+|[ \t]+$/,"",$2)} $2==b {gsub(/ /,"",$3); print $3; exit}')"
[ "${PU_EXIT:-1}" = 0 ] && verdict="**exit 0** ✓" || verdict="**exit ${PU_EXIT:-?}** ✗"
wrapper_wall=""; [ -n "$PU_START" ] && [ -n "$PU_END" ] && wrapper_wall="$(fmt_dur $((PU_END - PU_START)))"

lane_md="$(lane_table x86_64-linux 3>/tmp/.lanewall.$$)"; lane_wall="$(cat /tmp/.lanewall.$$ 2>/dev/null)"; rm -f /tmp/.lanewall.$$

{
  echo "## 🧪 CI metrics — leased pool box"
  echo
  if [ -n "$box" ]; then
    host_desc="**\`$box\`**${loc:+ (\`$loc\`)}"
    [ -n "${PU_EPHEMERAL:-}" ] && host_desc="$host_desc — _cold ephemeral fallback (pool was saturated)_"
  else
    host_desc="_no pool box — resolved via \`hosts.json\`_"
  fi
  echo "The **x86_64-linux** lane ran on $host_desc — commit \`${PU_SHA:-?}\`, $verdict"
  echo
  printf -- "- **Lane wall** (pipeline): **%s**\n" "$([ -n "$lane_wall" ] && fmt_dur "$lane_wall" || echo '?')"
  [ -n "$wrapper_wall" ] && printf -- "- **Wrapper wall** (incl. lease + nix-run startup): %s\n" "$wrapper_wall"
  echo
  echo "$lane_md"
  echo
  echo "### Pool status ($POOL_SIZE boxes)"
  echo
  pool_status
  echo
  echo "<sub>Posted by \`ci/pu/report.sh\`. Lane timings parsed from \`.ci/pc.log\`; pool state is a live \`flock\` probe.</sub>"
} >/tmp/pu-ci-report.$$.md

if [ -n "$dry" ]; then
  cat /tmp/pu-ci-report.$$.md
else
  gh pr comment "$pr" --body-file /tmp/pu-ci-report.$$.md && echo "posted CI metrics to PR #$pr" >&2
fi
rm -f /tmp/pu-ci-report.$$.md
