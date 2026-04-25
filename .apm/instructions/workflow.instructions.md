---
description: Core workflow conventions — pipeline commands, formatting, git, feature discoverability, external libraries
applyTo: "**"
---

## Workflow

- Use `/do` to execute tasks end-to-end: sync → research → hickey → branch+PR → implement → check → docs → police → fmt → commit → test → CI → update-pr → done. Each step has a verification check.
- For standalone quality checks, run `/code-police` (includes rules checklist + fact-check + elegance passes).
- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Execute Pipeline Commands

These commands are used by the `/do` workflow's check, fmt, test, and ci steps.

### Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

### Format command

`just fmt` — runs Prettier over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is installed (see [#710](https://github.com/juspay/kolu/issues/710)) and used only for linting in this PR; a follow-up flips formatting from Prettier to Biome. Config lives in `biome.jsonc` at the repo root.

### Test command

Invoke the `/test` skill. It selects relevant `.feature` files from the git diff and runs `just test-quick`.

### CI command

Invoke the `/ci` skill. It runs `just ci` via the Monitor tool and cross-checks posted GitHub commit statuses against `just ci::_contexts` so missing steps can't silently pass.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `settings/tips.ts` and `settings/useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
