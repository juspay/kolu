# Proposals

This directory holds **proposals** — short specs for changes to kolu's user-visible behavior, agreed upon *before* implementation begins. The pattern is borrowed from [Rust RFCs](https://github.com/rust-lang/rfcs), [Python PEPs](https://peps.python.org/), and [React RFCs](https://github.com/reactjs/rfcs).

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

- Updating the `Status:` line (e.g. `accepted` → `implemented in #N`).
- Fixing a typo that doesn't change meaning.

If the design needs to change after merge, write a *new* proposal that supersedes the old one, and link them in both directions.

## Status

Every proposal carries a `Status:` line at the top:

| Status | Meaning |
|---|---|
| `draft` | Under discussion in its PR |
| `accepted` | Merged, awaiting implementation |
| `implemented in #N` | Done — see PR `#N` for the code |
| `superseded by #M` | Replaced by proposal #M |
| `rejected` | Proposal PR closed without merge |

## Numbering

Sequential, four-digit, starting at `0001`. `0000-template.md` is the template and is not a real proposal — pick the next free number when you draft.
