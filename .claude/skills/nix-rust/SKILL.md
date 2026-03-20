---
name: nix-rust
description: Conventions for Rust development workflow in Nix-based projects with cargo-watch.
user-invocable: false
---

# Rust Dev Workflow (Nix)

## Rapid feedback with `just watch`

Run `just watch` in the background at the start of any code-editing task. It launches `cargo watch -x 'clippy --workspace --all-targets'` which automatically re-runs clippy on every `.rs` file change.

Use Bash with `run_in_background: true` to start it, then periodically check `TaskOutput` for compilation errors and clippy warnings as you edit. This catches mistakes early without waiting for a manual clippy run at the end.

## Devshell provides all tools

`cargo-watch`, `rustfmt`, `clippy`, and the full Rust toolchain come from the Nix devshell. No manual installs needed. The justfile auto-detects whether you're inside `nix develop` and wraps commands accordingly.

## Workspace-wide checks

Always use `--workspace --all-targets` flags with clippy/check to cover all crates (common, server, client) and all target types (lib, bin, tests, examples).
