# Contributing to kolu

In 2026, anyone can ask a coding agent for a 500-line PR in an afternoon. The bottleneck isn't *who writes the code* — it's *who agrees to maintain the feature*. So we keep the conversation about **what to build** separate from the conversation about **how to build it**.

## TL;DR

- **Trivial fix?** Open a PR directly.
- **New user-facing feature, behavior change, or anything reasonable people might disagree about?** Open a *proposal* first.

## 1. Trivial PRs — open directly

No proposal needed for: bug fixes that restore obvious behavior, build/packaging/CI fixes, doc typos, behavior-preserving refactors, or tests for existing behavior.

## 2. Proposals — what and why, not how

Anything user-facing — new shortcuts, settings, UI, defaults, persisted data, or new runtime dependencies — needs a merged proposal before any implementation PR.

A proposal is an **Atlas note** — a markdown/MDX file in [`docs/atlas/src/content/atlas/`](./docs/atlas/src/content/atlas/) with `kind: proposal`. Create `<your-slug>.mdx` with this frontmatter:

```yaml
---
title: Your proposal, in Title Case
description: One line — what changes from the user's perspective.
kind: proposal
status: proposed   # proposed → accepted → implemented (or superseded)
maturity: seedling
---
```

Then write the body — *Summary · Motivation · User-facing behavior · Prototype (optional) · Implementation notes (optional)* — run `just atlas::build` to render it, and open a PR adding the `.mdx` **and** its generated `docs/atlas/dist/<slug>.html` (the `ci::atlas-sync` gate checks the two stay in sync). Your note shows up in the **Incoming proposals** section of the [Atlas index](./docs/atlas/dist/index.html) automatically — nothing to wire up, and authorship is just the git history.

Discuss on the PR. Once **accepted**, a maintainer re-files it under its real kind (`feature`/`bug`/…) so it graduates out of the intake queue. The note stays a *living* document afterward (git is its record — there is no frozen copy).

Your PR **may optionally bundle an implementation** alongside the proposal — but acceptance merges **only the proposal**. The implementation is reviewed and merged separately (by you or anyone, including a maintainer running `/be`), so the decision to *ship the idea* never rides on the state of the code.

Implementation details are optional — the "Implementation notes" section is for hints; skip it if you don't have an opinion. The implementer figures out the *how*.

### Drafts welcome

Open the PR as a GitHub *draft* if you're still brainstorming or have open questions you want directional feedback on. Mark it ready for review when the questions narrow.

### Why proposals matter

A merged proposal under your authorship is a substantial contribution in its own right — clarifying a vague idea into a concrete, debatable document is half the work, and the implementation usually follows mechanically. **Proposals from people who never write the code are welcome and valued.**

**Feature PRs that skip the proposal step will be closed with a pointer back here.** It's the only way to keep the project's surface area honest.

## Using AI

Coding agents are great at fleshing out a proposal — motivation, alternatives, edge cases, open questions. **Use them.** What we don't want is an AI-drafted *implementation* of a feature nobody has agreed to ship.

## Implementer notes

For `/do`, `/test`, `/ci`, formatter, and other implementer-side conventions, see `.agency/do.md`.
