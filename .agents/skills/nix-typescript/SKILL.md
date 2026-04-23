---
name: nix-typescript
description: pnpm + Nix build conventions. Covers fetchPnpmDeps hash management and dependency workflow.
user-invocable: false
---

# TypeScript + Nix (pnpm)

## Dependency hash management

`nix/modules/typescript.nix` uses `fetchPnpmDeps` with a pinned hash. When `pnpm-lock.yaml` changes (via `pnpm add/remove/update`), this hash goes stale and `nix build` fails.

### Fix recipe

1. Run `nix build 2>&1` — it fails with a hash mismatch
2. Extract the correct hash from the `got: sha256-...` line in the error
3. Update the `hash = "sha256-..."` line in `nix/modules/typescript.nix`

### Parallelization

**Run the hash fix in background immediately after `pnpm-lock.yaml` changes.** Don't wait until end of session — kick it off as soon as the lock file is modified, then continue coding. The `nix build` takes minutes; doing it in background avoids blocking other work.

## Build

- `nix build` — full production build (client + server bundle)
- `nix run` — build and run
- Client is built with `pnpm --filter kolu-client build` (Vite)
- Server runs via `tsx` (TypeScript execution without compile step)
