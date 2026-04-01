---
name: nix-typescript
description: bun + Nix build conventions. Covers bunDeps hash management and dependency workflow.
user-invocable: false
---

# TypeScript + Nix (bun)

## Dependency hash management

`default.nix` uses a fixed-output derivation (`bunDeps`) with a pinned hash. When `bun.lock` changes (via `bun add/remove/update`), this hash goes stale and `nix build` fails.

### Fix recipe

1. Set `outputHash = "";` and add `outputHashAlgo = "sha256";` in `default.nix`
2. Run `nix build 2>&1` — it fails with a hash mismatch
3. Extract the correct hash from the `got: sha256-...` line in the error
4. Replace the empty hash with the correct one

### Parallelization

**Run the hash fix in background immediately after `bun.lock` changes.** Don't wait until end of session — kick it off as soon as the lock file is modified, then continue coding. The `nix build` takes minutes; doing it in background avoids blocking other work.

## Build

- `nix build` — full production build (client + server bundle)
- `nix run` — build and run
- Client is built with `bun run build` (Vite) inside the client workspace
- Server runs via `bun` (TypeScript execution without compile step)
