#!/usr/bin/env bash
set -uo pipefail

stage="${1:?usage: dev/skills/ci/pu/diagnose.sh <stage> <host> [--pr N] [--dry-run]}"; shift || true
host="${1:?usage: dev/skills/ci/pu/diagnose.sh <stage> <host> [--pr N] [--dry-run]}"; shift || true

dry_run=
pr=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --pr) pr="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$pr" ] || pr=$(gh pr view --json number --jq .number 2>/dev/null || echo "?")

render() {
  echo "## ⚠️ \`pu\` misbehaved — Incus admin attention needed"
  echo
  echo "- **PR:** #$pr &nbsp; **branch:** \`$(git rev-parse --abbrev-ref HEAD)\` &nbsp; **commit:** \`$(git rev-parse --short HEAD)\`"
  echo "- **Stage:** \`pu $stage\` &nbsp; **box:** \`$host\` &nbsp; **when:** $(date -u +%FT%TZ)"
  echo
  echo "**Box placement (\`pu list\` — NAME + physical LOCATION that needs fixing):**"
  echo '```'; pu list 2>&1 | grep -E "NAME|$host"; echo '```'
  echo "**\`pu $stage\` stderr:**"
  echo '```'; cat "/tmp/pu-$host.err" 2>/dev/null; echo '```'
  echo "**Box network state (resolv.conf / routes / egress / gateway TCP):**"
  echo '```'
  pu connect "$host" -- '
    echo "== /etc/resolv.conf =="; cat /etc/resolv.conf
    echo "== ip route ==";        ip route
    echo "== egress probe ==";    timeout 15 curl -sS -o /dev/null -w "https HTTP %{http_code}\n" https://api.github.com || echo "egress FAILED"
    echo "== gateway TCP ==";     gw=$(ip route | awk "/default/{print \$3; exit}"); timeout 5 bash -c "echo > /dev/tcp/$gw/443" && echo "gw $gw:443 ok" || echo "gw $gw:443 FAILED"
  ' 2>&1
  echo '```'
}

if [ -n "$dry_run" ]; then
  render
else
  render | gh issue comment 1204 --repo juspay/kolu --body-file -
fi
