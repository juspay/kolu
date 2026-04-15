# Nix Eval Performance Report

## Baseline (before any changes)

| Metric | Value |
|--------|-------|
| `nix develop -c true` cold (fresh HOME) | **2500ms** |
| `nix develop -c true` hot (eval cache) | **333ms** |

## Hot-path analysis

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
| `playwright-driver.browsers` | 293ms |
| `nix eval .#devShells...name` | 430ms |
| `nix print-dev-env` | 2230ms |
| `nix develop -c true` | 2500ms |

## Optimization log

| # | Commit | Change | Cold (ms) | Hot (ms) | Δ Cold | Δ Hot |
|---|--------|--------|-----------|----------|--------|-------|
| 0 | (baseline) | — | 2500 | 333 | — | — |
| 1 | 6119981 | writeShellApplication → writeShellScriptBin in clipboard-shims | 1978 | 194 | -522 | -139 |
| 2 | 2f9a6a2 | Consolidate worktree-words into single runCommand | 2005 | 192 | +27 | -2 |
| 3 | dfa182f | Import env.nix directly in shell.nix | 1994 | 194 | -11 | +2 |
| 4 | 942d1a9 | Defer playwright-driver.browsers path resolution | 2021 | 197 | +27 | +3 |
| 5 | 614323e | Defer drv path resolution in env.nix | 1970 | 197 | -51 | 0 |
| 6 | — | Share npins import for ghostty-themes (arch cleanup, no perf change) | — | — | — | — |
| 7 | — | Disable flake registry lookups (use-registries = false) | 1701 | 187 | -269 | -10 |
| 8 | — | Move playwright-driver.browsers to devShells.e2e | 1046 | 131 | -655 | -56 |
| 6 | — | Share npins import for ghostty-themes via overlay | 1976 | 199 | +6 | +2 |
