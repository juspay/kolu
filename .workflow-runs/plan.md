# Plan: Optimize `just fmt` (15s → ~2.5s)

## Problem

`just fmt` takes ~15s because it invokes `nix develop` twice — once for `prettier` and once for `nixpkgs-fmt`. Each `nix develop` costs ~5.5s of evaluation overhead, even though the actual formatting takes ~3s total.

## Root Cause

The `nix_shell` variable in the justfile is a per-line prefix. Each line with `{{ nix_shell }}` spawns a separate `nix develop` process.

## Fix

1. **Combine both formatters** into a single `nix develop -c sh -c '...'` invocation for both `fmt` and `fmt-check` recipes.
2. **Add `--cache` to prettier** (`--write --cache` for fmt, `--check --cache` for fmt-check) so unchanged files are skipped on subsequent runs.

## Expected Results

- Cold run (no prettier cache): ~3.3s (down from ~15.6s)
- Warm run (prettier cache hit): ~2.5s
- No functional changes — same formatters, same files, same output.

## Files Changed

- `justfile` — `fmt` and `fmt-check` recipes
