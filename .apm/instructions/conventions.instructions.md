---
description: Project-wide conventions — pipeline overview, feature discoverability, git
applyTo: "**"
---

## Workflow

- Use `/do` to execute tasks end-to-end: sync → research → hickey → branch+PR → implement → check → docs → police → fmt → commit → test → CI → update-pr → done. Each step has a verification check.
- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `settings/tips.ts` and `settings/useTips.ts` for the registry and API.

## Reserved Keybindings

When adding or rebinding a global shortcut in `input/actions.ts`, check `input/prohibitedKeybinds.ts` — those chords are claimed by tools that run inside kolu PTYs (Claude Code's Ctrl+B / Ctrl+J today) and must reach the terminal. The collision is unit-tested in `keyboard.test.ts`; add an entry there when a new tool reserves a chord.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
