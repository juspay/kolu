---
paths:
  - "**"
---

## Communication

- **Answer in plain words.** When the user asks you to explain, summarize, or reason about something (not write code), reach for everyday language first and keep it short. Introduce a piece of jargon, a symbol-heavy phrasing, or an internal codename only when it carries weight the plain word can't — then gloss it once. This is the default for *every* turn, not a per-request favor: the user should never have to ask twice.
- **Lead with the conclusion.** Same turns as above: open with the answer itself — the proposal, the verdict, the number — then add only what that answer can't stand without. Around 150 words is the ceiling; the reasoning, the alternatives you weighed, and the comparison tables are things to *offer*, not to include. When there is genuinely more to say, put it in a file or a PR body the user can read on their own time.

## Workflow

- Use `/be` to take a task end-to-end. It owns its own phase list and review gauntlet — don't restate them here.
- Run `just fmt` (formatting) before declaring done.
- **Change a file with the Edit tool, not a stream editor.** `sed -i` / `perl -0pi` against one file is silent when the pattern misses and destructive when it over-matches — a wrong quantifier truncates or empties the file, and you only notice later. Edit fails loudly on a missed anchor, which is the fail-fast behaviour this repo wants everywhere else. Reach for a stream editor only for the same mechanical substitution across *many* files, where per-file Edits aren't practical.
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
