#!/usr/bin/env bash
# Lane 2 entry point — live-host oracle. NEVER gates a merge.
#
# Builds (or reuses) the nix-packaged osfacts, then runs the cucumber
# scenarios against a real, noisy host. Diffs answers against `ss` (linux)
# or `lsof` (darwin). Exit non-zero on structural disagreement after one
# re-sample; the caller (a nightly job, a human) decides what to do.
#
# Usage (from repo root or osfacts/):
#   ./osfacts/scripts/live-oracle.sh
#   OSFACTS_BIN=/path/to/osfacts ./osfacts/scripts/live-oracle.sh

set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if [[ -z "${OSFACTS_BIN:-}" ]]; then
  echo "live-oracle: nix build .#osfacts …" >&2
  out="$(nix build "$root"#osfacts --no-link --print-out-paths)"
  export OSFACTS_BIN="$out/bin/osfacts"
fi
echo "live-oracle: binary=$OSFACTS_BIN" >&2
"$OSFACTS_BIN" snapshot --procs >/dev/null  # fail fast if the binary is broken

export OSFACTS_LIVE=1
# cargo test drives the harness=false cucumber binary. Dev-deps come from
# the local Cargo.lock; the hermetic gate is nix/nextest, not this script.
cd "$root/osfacts"
if command -v cargo >/dev/null 2>&1; then
  cargo test --test live_oracle -- --nocapture
else
  # Fall back to a nix-shell when cargo isn't on PATH (CI boxes, clean hosts).
  nix-shell -p cargo rustc --run 'cargo test --test live_oracle -- --nocapture'
fi
