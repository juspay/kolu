# dock

- Kind: how-to. Reader: someone navigating a workspace of live terminals from the left edge.
- Rewritten from: `f50641c6a`
- Words: 2,090 → 1,186 (about 200 of these are the indicator table, which the counter includes)
- Frontmatter: description 274 → 155 characters. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| Two levels of detail | Rail and cards |
| One indicator per row | What a row shows · What the indicator shows · The counts in each repo header · Row order · Splits |
| Your own arrangement | Rearrange the dock |
| The Needs-you strip | The Needs-you strip |
| The Filters row — keep it to what matters | The Filters row |

No page, changelog entry or README links into a `dock` heading (`.waterfall/anchors.md` lists none), so no link needed updating.

The old page's link to `/agent-detection#before-the-first-prompt` now points at `/agent-detection`, because that page is being rewritten in the same wave and the anchor may not survive.

## Moved

- What each agent state means to you → `notifications` (linked from "What the indicator shows"). The dock page keeps only what its own indicator shows.

## Cut

| Fact | Tag |
| --- | --- |
| The Conductor's view being the conversation and nothing else, and its terminals living on the host tabs you came from | duplicate (`conductor`) |
| "A mark you catch at the edge of vision survives on area"; the corner badge pulsing and unread threads going unnoticed; motion on a 7px object | rationale |
| "The row, not a dot on it, is what carries attention" | rationale |
| Two strengths of one hue so "answer me" never reads as quietly as "just finished" | rationale |
| "Recency has not gone anywhere — it just stopped deciding positions" | history |
| "the third row is still the third row tomorrow" | rationale |
| The canvas tab strip flattening a split of a split, unlike the dock | visible on screen |
| A split having no display identity of its own, the parent row already badging the repo | rationale |
| Resizing going through the `capturePointerGesture` pointer variant while rearranging and re-homing go through solid-dnd; the 250 ms / 10 px pointer activation distance; the capsules never becoming the grip | implementation |
| "Which repo a terminal belongs to is obvious without reading a label that has scrolled away"; "a little air between cards so a busy fleet stays scannable" | visible on screen |
| The strip being "a mirror, not a move" as a phrase (the behaviour it describes is kept) | rationale |
| "Waiting the longest is the one thing that must never cost you your place in the strip" | rationale |
| "nothing important stays buried" | rationale |
| The repo card's coloured spine, monogram tile, tinted header, per-branch row colours and inter-card spacing (the pinned repo header is kept, since it is how you tell which repo a row belongs to) | visible on screen |
| The indicator's spin period (2.8s), the 3px leading stripe, the bold title, the row's ~55% sleeping opacity, the "same sizes" of a split's entry, the split's worktree colour and missing PR badge | visible on screen |
| The maximized dock being "a real sidebar beside the canvas"; the rail's fixed width and the tiled dock's default width stated separately (both now read "keep their own widths") | visible on screen |
| The second dock-vs-canvas contrast ("tiles wherever you dragged them") in the opening | visible on screen |
| "The same StatePip leads the tile title bar" | implementation (the name) and visible on screen |
| The Conductor's **open tile** action on its tool cards | duplicate (`conductor`) |
| "a split has no display identity of its own … the entries are the inventory" as an explanation | rationale |
| "a filter can never lose a cluster you pinned far earlier" kept; the restatement that a drag writes the visible order "so" that holds, trimmed | duplicate |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `capturePointerGesture` | cut, implementation (the drag-library split) |
