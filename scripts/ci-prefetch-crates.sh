#!/usr/bin/env bash
# Pre-populate the nix store with crates.io tarballs that nixpkgs' fetchurl
# can't download. crates.io's anti-bot layer returns HTTP 403 for requests
# carrying a `curl/*` User-Agent — the default for nixpkgs fetchurl — which
# blocks every `crate-*.tar.gz` fixed-output derivation in this project's cargo
# vendor closure. Measured 2026-08-27:
#
#     curl -A 'curl/8.5.0'  .../crates/cucumber/0.23.0/download  -> 403
#     curl -A 'Mozilla/5.0' .../crates/cucumber/0.23.0/download  -> 200
#
# `NIX_CURL_FLAGS` is listed in fetchurl's `impureEnvVars`, but it is read from
# the BUILD DAEMON's environment, so neither exporting it nor `--option
# impure-env` reaches the builder on a daemon install. Both were tried; both
# still 403.
#
# Workaround: fetch each missing crate with a non-curl UA, then inject the
# tarball into the local store with `nix-store --add-fixed sha256`. That yields
# a content-addressed path identical to the FOD's declared `outputHash`, so the
# subsequent `nix build` finds the artifact already realised and never touches
# the network for it.
#
# Idempotent: crates whose output is already valid in the store are skipped, so
# a warm store (or a populated substituter) makes this a few metadata lookups.
#
# Drop this script and its CI step once upstream nixpkgs sidesteps the UA
# filter (e.g. by fetching from `static.crates.io` directly).
#
# The only Rust in kolu's closure is `osfacts`, built from the npins pin — so
# that is the attribute walked. This bites exactly when the pin MOVES: a pin
# kolu has built before is substituted whole from cache.nixos.asia and never
# fetches a crate, while a freshly-pinned revision must build from source on a
# box whose store has none of them. That is how juspay/kolu#2218 turned green
# `ci::nix` red on darwin by doing nothing but advancing the osfacts pin.
#
# Shared, not duplicated by accident: juspay/osfacts carries this same script
# for its own two CI lanes, and juspay/drishti carries the bun2nix-closure
# variant it was ported from. Two details this version fixes and those should
# take: each download URL comes from the derivation's own `urls` attribute
# rather than being rebuilt from the store basename (rebuilding does not survive
# cargo's `+build` metadata — `wasip2-1.0.4+wasi-0.2.12` splits into name
# `wasip2-1.0.4+wasi` and version `0.2.12`, which 404s), and the temp file is
# named WITHOUT the store hash prefix so `--add-fixed` mints the FOD's own path.


set -euo pipefail

UA='Mozilla/5.0'
flake_root=${1:-.}

osfacts_drv=$(nix eval --raw "${flake_root}#osfacts.drvPath")
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

# Collect to a FILE first, then loop over it — a `while read` on the right of a
# pipe runs in a subshell, where `set -e` kills only that subshell and the
# script exits 0 with the work half done. A failed fetch must fail the CI step,
# not be swallowed. (A file rather than `mapfile`: macOS runners ship bash 3.2,
# which has no `mapfile`.)
list="$tmpdir/crate-drvs"
nix-store --query --requisites "$osfacts_drv" | grep 'crate-.*\.tar\.gz\.drv$' > "$list" || true

total=$(wc -l < "$list" | tr -d ' ')
prefetched=0
while IFS= read -r cdrv; do
  [ -n "$cdrv" ] || continue
  out=$(nix-store --query --outputs "$cdrv")
  if nix-store --check-validity "$out" 2>/dev/null; then
    continue
  fi

  # Two shapes to survive: nix >= 2.31 wraps the map in `.derivations`, and a
  # `structuredAttrs` derivation (which these are) carries `urls` there rather
  # than in `env`. `..|objects|.urls?` finds it either way; `env.url` is the
  # unstructured fallback.
  url=$(
    nix derivation show "$cdrv" \
      | jq -r '[.. | objects | (.urls? // empty)] + [.. | objects | (.env?.url? // empty)]
               | flatten | map(select(type == "string" and startswith("http"))) | first // ""'
  )
  if [ -z "$url" ] || [ "$url" = "null" ]; then
    echo "no url on $cdrv" >&2
    exit 1
  fi

  # `nix-store --add-fixed` names the store path after the FILE's basename, so
  # the temp file must be named `crate-<name>-<ver>.tar.gz` — the store path's
  # name WITHOUT its hash prefix. Naming it after the full basename mints
  # `<newhash>-<oldhash>-crate-…`, a path no FOD is looking for, and the build
  # then 403s exactly as if nothing had been prefetched.
  store_name=$(basename "$out" | cut -d- -f2-)
  tmp="$tmpdir/$store_name"
  curl -fsSL -A "$UA" -o "$tmp" "$url"
  added=$(nix-store --add-fixed sha256 "$tmp")

  # Self-check, because the failure mode above is silent: unless the path we
  # just added IS the FOD's output path, we have cached nothing useful.
  if [ "$added" != "$out" ]; then
    echo "prefetch landed at $added but the FOD wants $out" >&2
    exit 1
  fi

  echo "prefetched: $store_name"
  prefetched=$((prefetched + 1))
done < "$list"

echo "prefetched $prefetched crate(s); $total in closure"
