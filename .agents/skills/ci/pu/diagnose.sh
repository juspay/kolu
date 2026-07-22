#!/usr/bin/env bash
# Post a `pu`-misbehaved diagnostic comment to the central pu-issues log
# (juspay/kolu#1204) so the pu/Incus admin can pin and permanently fix the bad
# physical host instead of every CI run papering over it. Whenever `pu` fails to
# do its job — create/fork errors, a box with no egress ("Resolving timed out"),
# a cross-gateway fork that's unreachable, retries landing on dead hosts, or
# connect/destroy misbehaving — run this, then continue per the fallback in the
# `ci` skill. A diagnostic comment must never block the run: this is best-effort
# and degrades (a missing box, no ssh) rather than erroring out.
#
# It gathers everything the admin needs to identify the bad host: the PR/branch/
# commit context, `pu list` placement (NAME + physical LOCATION), the failing
# stage's captured stderr, and — if the box came up enough to ssh into — its
# network state (resolv.conf / routes / egress probe / gateway TCP).
#
# Capture the failing stage's stderr for the excerpt by tee-ing it when you
# invoke pu, e.g.:  pu create "$host" 2> >(tee /tmp/pu-$host.err >&2)
#
# Usage:
#   .apm/skills/ci/pu/diagnose.sh <stage> <host>            # post to #1204
#   .apm/skills/ci/pu/diagnose.sh <stage> <host> --dry-run  # print, don't post
#   .apm/skills/ci/pu/diagnose.sh <stage> <host> --pr 123   # override PR number
#
#   <stage> is the pu subcommand that misbehaved: create | connect | destroy | egress
#   <host>  is the box name.
set -uo pipefail

stage="${1:?usage: .apm/skills/ci/pu/diagnose.sh <stage> <host> [--pr N] [--dry-run]}"; shift || true
host="${1:?usage: .apm/skills/ci/pu/diagnose.sh <stage> <host> [--pr N] [--dry-run]}"; shift || true

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
  # Box-side network state — only if the box came up enough to SSH into
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
