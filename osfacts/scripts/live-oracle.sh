#!/usr/bin/env bash
# Lane 2 entry point — live-host oracle. In the full `/ci` run DAG
# (`ci::osfacts-live`, after `ci::osfacts` / `nix`) on both platforms; never a
# merge-required status (odu has no soft-fail node).
#
# Builds (or reuses) the nix-packaged osfacts, then runs the cucumber scenarios
# against a real, noisy host. Diffs answers against `ss` (linux) or `lsof`
# (darwin). Exit non-zero on structural disagreement after one re-sample —
# honest red for the attended run, no exit-0 wrapper.
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
# Always use the repo-pinned nixpkgs toolchain — ambient cargo/rustc can miss
# link deps (darwin `-liconv` on rasam) even when `cargo` is on PATH.
# `nix shell` alone puts bins on PATH but does NOT set library search paths,
# so rustc still fails with "library not found for -liconv" unless we pin
# LIBRARY_PATH / RUSTFLAGS to the same pin's libiconv.
cd "$root/osfacts"

iconv_lib="$(nix eval --impure --raw --expr \
  'let pkgs = import ../nix/nixpkgs.nix {}; in "${pkgs.libiconv}/lib"')"
echo "live-oracle: cargo test via repo-pinned nixpkgs (libiconv=$iconv_lib)" >&2
# Relative path is from osfacts/ (cwd above).
nix shell --impure \
  --expr 'let pkgs = import ../nix/nixpkgs.nix {}; in [ pkgs.cargo pkgs.rustc pkgs.stdenv.cc pkgs.libiconv ]' \
  -c bash -c "export LIBRARY_PATH=\"${iconv_lib}\${LIBRARY_PATH:+:\$LIBRARY_PATH}\"; export RUSTFLAGS=\"-L ${iconv_lib} \${RUSTFLAGS:-}\"; cargo test --test live_oracle"
