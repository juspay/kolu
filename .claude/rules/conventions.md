---
paths:
  - "**"
---

## Communication

- **Answer in plain words.** When the user asks you to explain, summarize, or reason about something (not write code), reach for everyday language first and keep it short. Introduce a piece of jargon, a symbol-heavy phrasing, or an internal codename only when it carries weight the plain word can't — then gloss it once. This is the default for *every* turn, not a per-request favor: the user should never have to ask twice.

## Workflow

- Use `/be` to take a task end-to-end: interview → setup → implement (test-first) → draft PR → review gauntlet (lens-debate → codex-debate → simplify → code-police) → ship (CI + evidence) → done. One interview up front, autonomous after.
- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.
- **Never write a raw control byte into source — emit the escape.** When a string needs a control character (a NUL `\0` separator, or any non-printable), write the **escape sequence** the language understands (` ` / `\x00` in TS/JS, `\0` in a regex), never the literal byte. A single raw NUL turns the whole file *binary*: git renders it as `Bin … -> … bytes` instead of a text diff, so PR review and codex/lens reviewers can't read the change, and it must be hand-repaired (e.g. `python3 -c 'p="f.ts";open(p,"wb").write(open(p,"rb").read().replace(b"\x00",b"\\u0000"))'`) before CI passes. This has bitten distinct agents on distinct files (main loop *and* a lens-apply subagent) — treat "intended an escape, emitted the byte" as a real failure mode, not a typo. If unsure a file you touched is clean, scan before committing: `for f in $(git diff --name-only); do perl -0777 -ne 'print "'"$f"': ", tr/\0//, " NUL\n" if tr/\0//' "$f"; done`.

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
