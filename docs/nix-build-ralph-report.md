# Ralph Report: `nix build` Time Optimization

## Target
Reduce `nix build .#default` wall-clock time (uncached, no eval cache).

## Constraints
- No dependency changes (don't add/remove/swap packages)
- Keep current toolchain (same bundler, test runner, etc.)
- Must preserve `nix run github:juspay/kolu` on Linux/Mac with just Nix installed

## Methodology
- **Measurement**: `nix build .#default --no-eval-cache --no-link` after deleting kolu-specific output paths from the Nix store
- **Runs per measurement**: 5 (report median)
- **Machine**: x86_64-linux, Nix 2.31.3

## Baseline
| Metric | Value |
|--------|-------|
| Median (5 runs) | **32.29s** |
| Runs | 33.02, 32.29, 32.11, 32.26, 32.41 |

### Component Breakdown (baseline)
| Component | Time | % of total |
|-----------|------|------------|
| Nix post-build overhead (NAR hash 395MB output) | 12.6s | 41% |
| fixupPhase (patchShebangs on 395MB output) | 6.4s | 21% |
| pnpmConfigHook (extract + install + patchShebangs) | 5.3s | 17% |
| Vite client build | 3.7s | 12% |
| node-gyp (node-pty native module) | 1.3s | 4% |
| Nix eval + sandbox setup | 0.9s | 3% |
| installPhase (cp -r + rm) | 0.6s | 2% |

**Key insight**: The 395MB output size is the dominant cost driver (41% NAR hashing + 21% fixup patching = 62% of build time). The output includes all 619 npm packages (dev + prod) because `cp -r . $out` copies everything.

## Optimization Log

| Cycle | Change | Before | After | Delta | Committed? |
|-------|--------|--------|-------|-------|------------|
| 1 | `dontFixup = true` — skip fixupPhase (strip, patchShebangs, patchELF) | 32.29s | 15.87s | -16.42s (51%) | Yes |
| 2 | Remove node-pty build artifacts from output (-62MB) | 15.87s | 15.76s | -0.11s (noise) | Yes |
| 3 | Remove build-only packages from output (-125MB, 395→208MB) | 15.76s | 14.89s | -0.87s (6%) | Yes |

## Dead Ends
- `dontPatchShebangs = true` (without dontFixup): Only 0.42s improvement — patchShebangs was 0.5s of the 6.4s fixupPhase; the rest was strip/patchELF tree traversal.
- `pnpm prune --prod`: Breaks pnpm workspace symlink structure, causing `ERR_MODULE_NOT_FOUND` at runtime.

## Key Findings
- fixupPhase re-patches shebangs that pnpmConfigHook already patched (redundant work)
- The 395MB output triggers expensive Nix store operations (NAR hashing, signing, registration)
- Only ~2.5MB of that output is actually kolu's own code; the rest is node_modules
- `dontFixup = true` saves 16.4s (51%) — far more than the 6.4s measured fixupPhase time, suggesting Nix store registration is significantly faster when the output hasn't been modified in-place by fixup operations
