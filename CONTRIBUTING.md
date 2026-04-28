# Contributing to kolu

Thank you for considering a contribution. These guidelines exist because, in 2026, *anyone* — maintainers included — can ask a coding agent for a 500-line PR in an afternoon. That makes the bottleneck no longer "who will write the code" but **"who has agreed to maintain this feature forever."** The rules below keep the conversation about *what* to build separate from the conversation about *how* to build it.

## TL;DR

- **Trivial fix?** Open a PR directly.
- **New user-facing feature, behavior change, or anything reasonable people might disagree about?** Open a *proposal* first — see [`docs/proposals/`](./docs/proposals/).

## Two paths

### 1. Trivial PR — open directly

Open a PR straight away when the change is one of:

- Bug fix that restores documented or obvious behavior
- Build, packaging, or CI fix (Nix, GitHub Actions, dependency bumps)
- Documentation typo, clarification, or example
- Refactor with no behavioral change
- Test added for existing behavior

Trivial PRs are reviewed on their merits. No proposal needed.

### 2. Proposal-first — discuss before coding

For anything else — especially anything that adds, removes, or changes a user-visible feature — **open a proposal PR first**, not a feature PR.

This includes (but is not limited to):

- New keyboard shortcuts, settings, commands, or palette entries
- New persisted data shape, schema, or storage location
- New UI surface (panels, dialogs, tiles, modals, indicators)
- Changes to the default behavior of an existing feature
- New library dependencies that ship in the user-facing build

A proposal is a short markdown file in [`docs/proposals/`](./docs/proposals/) describing what should change and why. The proposal PR is where we agree on **what to build**; once it merges, anyone — the original proposer, a different contributor, or a maintainer running `/do` — can implement the actual code in a follow-up PR.

A proposal is about **what** and **why**, not **how**. Implementation details are optional — the template has an "Implementation notes" section for hints if you have any, but skip it otherwise. The implementer figures out the *how*.

**Why this exists.** Writing code stopped being scarce; *agreeing to maintain it* is what's scarce. A proposal lets us debate scope, naming, defaults, and edge cases without arguing over a half-implemented diff. It also keeps your contribution permanent: when the proposal merges, your authorship is preserved in `git log` even if someone else writes the implementation later.

**A well-thought-out proposal is itself a substantial contribution.** Taking a fuzzy idea and turning it into something concrete enough that people can agree (or disagree) with — *clarifying the ambiguity is half the work*. Once that work is done, the implementation often falls out almost mechanically. A merged proposal under your authorship is a meaningful contribution to kolu in its own right; you don't have to write the code to have contributed something real. Some of the most valuable things you can send us are proposals you have no intention of implementing yourself.

**Feature PRs that skip the proposal step will be closed with a pointer back here.** This isn't personal. It's the only way to keep the project's surface area honest. If you're unsure whether your change needs a proposal, write a draft proposal — it's a few minutes of work and saves everyone the back-and-forth on a feature PR that ends up rejected.

## Using AI to draft a proposal

Coding agents are great at fleshing out a proposal — motivation, alternatives, edge cases, open questions. **Use them.** An AI-drafted *proposal* is exactly what we want. What we don't want is an AI-drafted *implementation* of a feature nobody has agreed to ship.

The template at [`docs/proposals/0000-template.md`](./docs/proposals/0000-template.md) is structured so an agent can fill it in from your prompt plus its reading of the codebase.

## Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Tidy up messy commit history before requesting review.

## Project workflow notes

For implementer-side conventions (`/do`, `/test`, `/ci` skills, formatter, etc.), see `.agency/do.md`.
