# Nix Eval Performance Report

## Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| `nix develop -c true` cold (fresh HOME) | **2500ms** | **925ms** | **-63%** |
| `nix develop -c true` hot (eval cache) | **333ms** | **120ms** | **-64%** |
| `nix develop .#e2e -c true` cold | — | **1677ms** | *new shell for e2e tests* |
| `nix develop .#e2e -c true` hot | — | **176ms** | *new shell for e2e tests* |

## Hot-path analysis (before optimization)

| Component | Cold eval time |
|-----------|---------------|
| bare nix eval overhead | 26ms |
| nixpkgs import (lazy) | ~300ms |
| `writeShellApplication` (1 trivial script) | **983ms** |
| `writeShellScriptBin` (same script) | 354ms |
| `wordnet` drv path | 615ms |
| `kolu-clipboard-shims` (2× writeShellApplication + symlinkJoin) | **935ms** |
| `kolu-worktree-words` (runCommand + symlinkJoin + wordnet) | 635ms |
| `kolu-ghostty-themes` | 360ms |
| `kolu-fonts` | 346ms |
| all four env vars together | 948ms |
| `playwright-driver.browsers` (realization) | **+600ms** |
| `nix eval .#devShells...name` | 430ms |
| `nix print-dev-env` | 2230ms |
| `nix develop -c true` | 2500ms |

## Key findings

1. **`writeShellApplication` is eval-toxic**: Pulls in `shellcheck` during Nix evaluation. A single trivial script costs 983ms vs 354ms for `writeShellScriptBin`. Replacing it in clipboard-shims saved **522ms cold, 139ms hot**.

2. **`playwright-driver.browsers` dominates realization**: Adding this single derivation to mkShell.env costs ~600ms in `nix develop` cold. Moving it to a separate `devShells.e2e` saved **655ms cold**.

3. **`use-registries = false` in nixConfig**: With zero flake inputs, registry lookups are pure waste. Disabling them saved **269ms cold**.

4. **String interpolation forces early drv path resolution**: `"${pkgs.foo}/path"` forces derivation instantiation during eval. Passing derivation references directly (when no subpath is needed) defers this to realization time.

5. **wordnet dependency closure is expensive**: Even though the worktree-words derivation is tiny (~10KB), its dependency on `wordnet` adds ~290ms realization cost. Pre-generating the word lists and committing them saved **56ms**.

6. **Irreducible floor**: `nix develop` with an empty mkShell takes ~692ms (Nix internals). The nixpkgs import alone is ~290ms. This is the floor we can't optimize from .nix files.

## Cost breakdown (after optimization)

| Component | Time | Notes |
|-----------|------|-------|
| nix develop base overhead | 692ms | Nix internals (irreducible) |
| nixpkgs import | ~290ms | Part of base overhead |
| flake eval cache savings | -200ms | Cached attr evaluation |
| koluEnv (overlay packages) | +23ms | Very cheap after optimizations |
| Shell packages (10 packages) | +278ms | Shared dependency graph |
| shellHook + misc | +12ms | Negligible |
| **Total (cold)** | **~990ms** | |

## Optimization log

| # | Change | Cold (ms) | Hot (ms) | Δ Cold | Δ Hot |
|---|--------|-----------|----------|--------|-------|
| 0 | Baseline | 2500 | 333 | — | — |
| 1 | `writeShellApplication` → `writeShellScriptBin` in clipboard-shims | 1978 | 194 | **-522** | **-139** |
| 2 | Consolidate worktree-words into single runCommand | 2005 | 192 | +27 | -2 |
| 3 | Import env.nix directly in shell.nix (arch cleanup) | 1994 | 194 | -11 | +2 |
| 4 | Defer playwright-driver.browsers path resolution | 2021 | 197 | +27 | +3 |
| 5 | Defer drv path resolution in env.nix | 1970 | 197 | -51 | 0 |
| 6 | Share npins import for ghostty-themes via overlay (arch cleanup) | — | — | — | — |
| 7 | Disable flake registry lookups (`use-registries = false`) | 1701 | 187 | **-269** | -10 |
| 8 | Move playwright-driver.browsers to `devShells.e2e` | 1046 | 131 | **-655** | **-56** |
| 9 | Static word lists (eliminate wordnet dependency) | 990 | 123 | -56 | -8 |
| 10 | Remove prettier from nix shell (use pnpm's) | 925 | 120 | -65 | -3 |
| 11 | **Switch justfile from `path:` to `git+file://`** | 925 | **129** | 0 | **-4092** |

## Investigated but no improvement

| What | Finding |
|------|---------|
| `mkShellNoCC` vs `mkShell` | No measurable difference — CC toolchain shared with node-gyp deps |
| Removing overlay | Actually slower (loses flake eval cache benefit) |
| `--no-write-lock-file` | No measurable difference |
| `--option substitute false` | No measurable difference |
| Per-package realization | Each package adds ~30-80ms; all share dependency graph |
| eachSystem evaluating both systems | Nix is lazy — only requested system evaluated |
| "copying to store" includes node_modules | **No** — flakes use `git ls-files` (2.4MB, 304 files). The 272 copy ops on cold eval are nixpkgs patches/scripts, not our code. Our source copy is ~3ms. |
| `path:.` scheme (avoids copy?) | **5x slower** (4659ms) — disables eval cache entirely |

## Methodology

- All measurements: median of 5 runs
- Cold: fresh `HOME` (temp dir with trusted-settings.json), no eval cache
- Hot: existing eval cache, same HOME
- Command: `nix develop --accept-flake-config -c true`
- System: x86_64-linux, Nix 2.31.3
