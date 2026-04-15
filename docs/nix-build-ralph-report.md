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

## Results

| | Median | Runs |
|---|---|---|
| **Baseline** | **32.29s** | 33.02, 32.29, 32.11, 32.26, 32.41 |
| **Final** | **14.55s** | 14.50, 14.55, 14.55, 14.56, 14.68 |
| **Improvement** | **-17.74s (55%)** | |

### Component Breakdown (baseline → final)
| Component | Baseline | Final | Savings |
|-----------|----------|-------|---------|
| Nix post-build overhead | 12.6s | 1.9s | -10.7s |
| fixupPhase | 6.4s | 0s | -6.4s |
| pnpmConfigHook | 5.3s | 4.4s | -0.9s |
| Vite client build | 3.7s | 3.8s | — |
| node-gyp (node-pty) | 1.3s | 1.4s | — |
| Nix eval + sandbox | 0.9s | 1.1s | — |
| installPhase | 0.6s | 0.7s | — |

## Optimization Log

| Cycle | Change | Before | After | Delta | Committed? |
|-------|--------|--------|-------|-------|------------|
| 1 | `dontFixup = true` — skip fixupPhase (strip, patchShebangs, patchELF) | 32.29s | 15.87s | -16.42s (51%) | Yes |
| 2 | Remove node-pty build artifacts from output (-62MB) | 15.87s | 15.76s | -0.11s (noise) | Yes |
| 3 | Remove build-only packages from output (-125MB, 395→208MB) | 15.76s | 14.89s | -0.87s (6%) | Yes |
| 4 | Delete dev packages before cp (not after) | 14.89s | 14.55s | -0.34s (noise) | Yes |

## Dead Ends
- `dontPatchShebangs = true` (without dontFixup): Only 0.42s improvement — patchShebangs was 0.5s of the 6.4s fixupPhase; the rest was strip/patchELF tree traversal.
- `pnpm prune --prod`: Breaks pnpm workspace symlink structure, causing `ERR_MODULE_NOT_FOUND` at runtime.

## Key Findings
- **`dontFixup` is the single biggest win.** The stdenv fixupPhase (strip, patchShebangs, patchELF) traverses the entire output tree. For a Node.js app this is pure overhead: shebangs are already patched by pnpmConfigHook, and the only native binary (node-pty .node) is correctly linked by node-gyp. Disabling it saves 16.4s (51%) — far more than the 6.4s measured fixupPhase time, suggesting Nix store registration is significantly faster when the output hasn't been modified in-place by fixup operations.
- **Output size directly impacts Nix overhead.** The 395MB output triggered 12.6s of Nix post-build overhead (NAR hashing, signing, registration). Reducing to 208MB cut this to 1.9s.
- **pnpm workspace pruning is fragile.** `pnpm prune --prod` breaks the virtual store symlink structure in workspace monorepos. Manual `rm -rf` of known dev packages is crude but reliable.
- **Most of the output is node_modules.** Only ~5MB of the 395MB original output was kolu's own code; the rest was 619 npm packages (dev + prod). After cleanup: 208MB with 480 packages.
