---
name: nix-pre-commit
description: Pre-commit hook conventions for Nix projects. Covers hook configuration and background execution.
user-invocable: false
---

# Pre-commit hooks (Nix)

## Configuration

Hooks are defined in `nix/modules/pre-commit.nix` via `git-hooks.nix` flake module:

- **nixpkgs-fmt** — Nix file formatting
- **prettier** — JS/TS/JSON/CSS formatting (excludes `pnpm-lock.yaml`)

## Running

```sh
just pc          # runs: nix develop -c pre-commit run -a
```

## Parallelization

**Run `just pc` in background after finishing a batch of edits.** Don't wait for it to complete before moving on to the next task. If it fails with formatting issues, fix them and re-run.
