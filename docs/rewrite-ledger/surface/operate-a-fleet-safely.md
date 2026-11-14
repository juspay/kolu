# operate-a-fleet-safely

- Kind: how-to. Reader: someone running a multi-host fleet and keeping it predictable.
- Rewritten from: `f50641c6a`
- Words: 680 → 700
- Frontmatter: unchanged.
- Sentence work. Five sentences over 40 words were split (membership teardown, the terminal network case, the remote fault, the `recheck()` paragraph). Emphasis bold and capitals (`**before**`, `**is**`, `**same**`, `CLASS`, `ONE`) were removed, keeping bold only for the **Reconnect** button. The 91-word note aside became list items and a short paragraph in "Keep one writer of membership", leaving one aside on the page. The `<Snippet>` tag is unchanged.

## Headings

Unchanged. The only inbound link (`a-fleet-of-surfaces`) is page-level.

## Moved

- The live-vs-remembered membership distinction moved out of an `<Aside>` into the body of "Keep one writer of membership" on this same page (both asides would otherwise have been notes, and each was over the 50-word limit).

## Cut

| Fact | Tag |
| --- | --- |
| The PR number `#1908` on the budget-exhausted provisioning case | history (the behaviour itself is kept) |
| "the honest transport cause" / "exactly the dual-authority drift the single-writer rule exists to make unconstructible" | rationale (phrased plainly; the rule and its consequence are kept) |
| "there is no second writer" as a separate clause | duplicate (the section opens with the single-author rule) |

## Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
