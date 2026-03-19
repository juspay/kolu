---
name: code-review
description: Review code for common mistakes caught during development. Run this before declaring any phase complete.
user_invocable: true
---

# Code Review Checklist

Review the current changes against these lessons learned. Flag any violations.

## Completeness

- **Implement the FULL spec.** Read the plan for the current phase and check every deliverable. Don't skip e2e tests, justfile recipes, or any other "boring" infrastructure item just because the Rust code compiles.
- **Run `vira ci -b` before declaring done.** Catches rustfmt, clippy, nixpkgs-fmt failures that `nix build` alone won't.
- **Run Playwright tests.** `cd tests && npx playwright test` must pass.

## Build & Dev Workflow

- **No GNU parallel.** Use `process-compose-flake` for running multiple dev processes. Ctrl+C must kill everything cleanly.
- **No background process hacks** (`cmd & cmd & wait`). Process supervision tools exist for a reason.
- **`.envrc` uses `use flake`**, not `use omnix`.
- **Pre-commit hooks run in CI.** If rustfmt reformats your code, fix it before committing — don't discover it in CI.

## Nix

- **WASM filenames use hyphens.** Cargo outputs `kolu-client.wasm` (hyphen), not `kolu_client.wasm` (underscore). wasm-bindgen then produces `kolu-client.js` and `kolu-client_bg.wasm`. Get these right in `rust.nix`.
- **Don't inline HTML in nix.** Use a file (`client/nix-index.html`) that the nix build copies. Avoids DRY violations between Trunk's `index.html` and the nix build.
- **Add comments to non-obvious nix.** The WASM build pipeline in `rust.nix` (crane → wasm-bindgen → wasm-opt → assemble dist → wrap) deserves explanation.

## DRY

- **Workspace version.** Crate `Cargo.toml`s should use `version.workspace = true`, not repeat the version string.
- **Don't duplicate nix derivation versions** with hardcoded strings when they can be derived.

## Gitignore

Check that these are gitignored:
- `.claude/worktrees/`
- `.pre-commit-config.yaml`
- `node_modules/`
- `test-results/`
- `target/`
- `result`
- `dist/`
- `.direnv/`

## Simple Made Easy

Per the project principles:
- No trait objects, `Arc<Mutex>`, manager objects, or builder patterns
- Plain structs with public fields, no getters/setters
- Each module does one thing
- Only `common::` types cross crate boundaries
- No abstractions "for future use"
