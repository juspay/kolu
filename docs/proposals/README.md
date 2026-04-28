# Proposals

This directory holds **proposals** — short documents describing changes to kolu's user-visible behavior, agreed upon *before* implementation begins. The pattern is borrowed from [Rust RFCs](https://github.com/rust-lang/rfcs), [Python PEPs](https://peps.python.org/), and [React RFCs](https://github.com/reactjs/rfcs).

A proposal is about **what** to build and **why**, not **how**. Implementation details are optional and can be filled in (or ignored) by whoever writes the code later.

**A well-fleshed-out proposal is a complete contribution.** Clarifying a vague request into a concrete, debatable document is the hard, valuable part — once a proposal merges, the implementation tends to fall out almost mechanically. Proposals authored by people who never write the code are welcome and valued.

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for when a proposal is required vs. when a direct PR is fine.

## How it works

1. **Draft.** Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-slug.md`, picking the next unused four-digit number. Fill it in.
2. **Open a PR** that adds only your proposal file. Use the PR body to summarize and link any related issues.
3. **Discuss** on the PR. Expect requests for clarification, alternatives, and scope changes.
4. **Merge or close.** If accepted, the proposal merges as-is. If rejected, the PR closes and the file doesn't land.
5. **Implementation** is a *separate* PR by anyone — original proposer, another contributor, or a maintainer running `/do` against the merged proposal. The implementation PR references the proposal number.

## Proposals are frozen records

Once a proposal merges, **don't edit it** to track implementation drift. The code is the source of truth for current behavior; the proposal is the historical record of what was agreed and who proposed it.

The only allowed post-merge edits:

- Updating the `status:` frontmatter field (e.g. `accepted` → `implemented`, with the corresponding PR number in `implemented-in`).
- Fixing a typo that doesn't change meaning.

If the design needs to change after merge, write a *new* proposal that supersedes the old one, and link them in both directions via the `superseded-by` and `supersedes` fields.

## Frontmatter

Every proposal opens with YAML frontmatter:

```yaml
---
title: Per-terminal light/dark theme slots
number: 0001
status: draft
author: your-github-handle
created: 2026-04-27
---
```

`status` is one of:

| Value | Meaning |
|---|---|
| `draft` | Under discussion in its PR |
| `accepted` | Merged, awaiting implementation |
| `implemented` | Done — set `implemented-in: <PR number>` alongside |
| `superseded` | Replaced — set `superseded-by: <proposal number>` alongside |
| `rejected` | Proposal PR closed without merge |

## Numbering

Sequential, four-digit, starting at `0001`. `0000-template.md` is the template and is not a real proposal — pick the next free number when you draft.

## Prototypes and assets

If your proposal benefits from visuals — UI mockups, HTML prototypes, flow diagrams, screen recordings — put them in a sibling directory matching your proposal slug, then link them from the proposal markdown via relative paths:

```
docs/proposals/0042-some-feature.md
docs/proposals/0042-some-feature/
├── mockup-light.png
├── mockup-dark.png
├── prototype.html
└── flow.svg
```

PNG and SVG render inline on GitHub. HTML/JS prototypes don't render live from the repo — for those, either ask reviewers to clone and open the file, or paste a hosted-preview link (CodeSandbox, StackBlitz, a gist) into the proposal alongside the committed source.

A working prototype is often the fastest way to resolve a UI debate. Ship one if you have it.
