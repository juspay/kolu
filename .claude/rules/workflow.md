---
paths:
  - "**"
---

## Workflow

- Use `/do` to execute tasks end-to-end: sync → research → hickey → branch+PR → implement → check → docs → police → fmt → commit → test → CI → update-pr → done. Each step has a verification check.
- For standalone quality checks, run `/code-police` (includes rules checklist + fact-check + elegance passes).
- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## /do project config

`/do` and the structural reviewers read their per-skill project config from `.agency/`:

- [`.agency/do.md`](../../.agency/do.md) — check / fmt / test / ci commands plus the PR evidence procedure
- [`.agency/code-police.md`](../../.agency/code-police.md) — Kolu-specific code-police rules
- [`.agency/hickey.md`](../../.agency/hickey.md) — Kolu-specific complecting patterns
- [`.agency/lowy.md`](../../.agency/lowy.md) — Kolu-declared areas of volatility

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `settings/tips.ts` and `settings/useTips.ts` for the registry and API.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
