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

osfacts_drv=$(nix eval --raw --accept-flake-config "${flake_root}#osfacts.drvPath")
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

  # `nix-store --add-fixed` names the store path after the FILE's basename, so
  # the temp file must be named as the store path is WITHOUT its hash prefix.
  # Naming it after the full basename mints `<newhash>-<oldhash>-crate-…`, a
  # path no fixed-output derivation is looking for, and the build then 403s
  # exactly as if nothing had been prefetched.
  store_name=$(basename "$out" | cut -d- -f2-)

  # PREFERRED: ask the derivation. Two shapes to survive — nix >= 2.31 wraps the
  # map in `.derivations`, and a `structuredAttrs` derivation carries `urls`
  # there rather than in `env`; `..|objects|.urls?` finds it either way, and
  # `env.url` is the unstructured fallback. stderr is captured rather than
  # dropped, so a `nix derivation show` that fails on some other nix build says
  # WHY instead of arriving here as a silent empty string.
  show_err="$tmpdir/show.err"
  url=$(
    nix derivation show "$cdrv" 2>"$show_err" \
      | jq -r '[.. | objects | (.urls? // empty)] + [.. | objects | (.env?.url? // empty)]
               | flatten
               | map(select(type == "string"))
               | map(split(" ")[]) | map(select(startswith("http")))
               | first // ""' 2>/dev/null
  )

  # FALLBACK: rebuild it from the store name. Correct-by-construction is not
  # possible here — a crate name may itself end in `-<digits>` — so this is a
  # heuristic: the version begins at the FIRST `-`-separated token that starts
  # with a digit, and runs to the end. That is what keeps cargo's `+build`
  # metadata intact (`wasip2-1.0.4+wasi-0.2.12` → name `wasip2`, version
  # `1.0.4+wasi-0.2.12`), where splitting on the LAST `-` would 404. A wrong
  # guess is not silent: the add-fixed assertion below compares the path we
  # minted against the path the FOD wants, and a wrong tarball cannot match it.
  if [ -z "$url" ]; then
    stem=${store_name%.tar.gz}
    stem=${stem#crate-}
    name=""; ver=""
    IFS='-' read -ra parts <<< "$stem"
    for i in "${!parts[@]}"; do
      case "${parts[$i]}" in
        [0-9]*)
          name=$(IFS='-'; echo "${parts[*]:0:$i}")
          ver=$(IFS='-'; echo "${parts[*]:$i}")
          break
          ;;
      esac
    done
    if [ -n "$name" ] && [ -n "$ver" ]; then
      url="https://crates.io/api/v1/crates/$name/$ver/download"
      echo "note: rebuilt url for $store_name (derivation gave none)" >&2
    fi
  fi

  if [ -z "$url" ] || [ "$url" = "null" ]; then
    echo "no url for $cdrv" >&2
    echo "--- nix derivation show stderr ---" >&2
    cat "$show_err" >&2 || true
    exit 1
  fi

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
