---
paths:
  - "**"
---

## Workflow

- Use `/be` to take a task end-to-end: interview → setup → implement (test-first) → draft PR → review gauntlet (lens-debate → codex-debate → simplify → code-police) → ship (CI + evidence) → done. One interview up front, autonomous after.
- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Design philosophy

Three principles the codebase is built on. Honor them **by default** when writing code — a violation is a defect to fix now, not a style preference or a follow-up.

- **Fail fast — no fallbacks, no backward-compat, no override knobs.** An override / knob / graceful-degradation path is a defect, not a feature ("being able to *override* is never a feature"). Bake required values in (e.g. via Nix) and **crash loudly** if one is absent rather than silently degrading. A caught error must surface, never collapse to an empty or default state — see `.agency/code-police.md` → `caught-error-must-not-collapse-to-empty`.
- **Volatility boundaries ("electricity").** A domain-agnostic capability that hides a *hard* volatility (transport, reconnect, persistence, GPU-context loss) is its own `@kolu/*` workspace package, with the dependency arrow pointing **out** — never folded into an app / browse / terminal module, however generic the code reads (location *is* structure). Apply the three tests in `docs/atlas/src/content/atlas/electricity.mdx` before extracting; a tidy generic helper that hides only a bounded algorithm is a *leaf*, not a receptacle.
- **Reuse the existing source of truth.** Prefer the repo's canonical mechanism or an existing code path over a parallel hand-rolled one — `.gitignore` / `@parcel/watcher` ignore globs over a hardcoded ignore list, an existing extension/MIME table over a duplicated constant, a maintained library (the rule above) over custom code. When unsure, grep for the existing path before writing a new one.

## Feature Discoverability (Tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `settings/tips.ts` and `settings/useTips.ts` for the registry and API.

## Reserved Keybindings

When adding or rebinding a global shortcut in `input/actions.ts`, check `input/prohibitedKeybinds.ts` — those chords are claimed by tools that run inside kolu PTYs (Claude Code's Ctrl+B / Ctrl+J today) and must reach the terminal. The collision is unit-tested in `keyboard.test.ts`; add an entry there when a new tool reserves a chord.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
