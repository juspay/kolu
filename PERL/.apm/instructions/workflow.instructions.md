---
description: Core workflow conventions — execute pipeline, CI, formatting, git, feature discoverability, external libraries
applyTo: "**"
---

## Workflow

- Use `/execute` to execute tasks end-to-end: sync → research → hickey → branch+PR → implement → docs → police → fmt → commit → test → CI → update-pr → done. Each step has a verification check.
- For standalone quality checks, run `/code-police` (includes rules checklist + fact-check + elegance passes).
- Run `just fmt` (formatting) before declaring done.
- **Quick e2e tests**: Run `just test-quick` (or `just test-quick features/foo.feature:42` for a single scenario) to verify UI changes. Fast — no nix build, no separate dev server.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Local CI

Run `just ci` to build and test across all systems. It:

- Runs preflight checks (clean worktree, commit pushed)
- Builds on x86_64-linux and aarch64-darwin in parallel
- Posts GitHub commit statuses per step
- Prints a summary table at the end

**Always run CI in background** (`run_in_background`). Builds take several minutes. **Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run.

Individual steps: `just ci::nix-toplevel`, `just ci::e2e`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Logs are saved to `.logs/<short-sha>/<step>@<system>.log`.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `tips.ts` and `useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
