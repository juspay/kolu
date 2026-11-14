# mobile

- Kind: how-to. Reader: someone using kolu from a phone, tablet or foldable.
- Rewritten from: `f50641c6a`
- Words: 792 → 465 (plan target 550)
- Frontmatter: description 247 → 148 characters. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| On a phone | On a phone |
| On a tablet or an unfolded foldable | On a tablet or an unfolded foldable |
| Multi-host from a phone | Switch machines from the phone |
| — (new, split out of "Multi-host from a phone") | The Conductor on a phone |
| Next | Next |

No inbound link points at any heading of this page, so none needed updating.

Outbound link changed: the host-row order sentence linked to
`/remote-hosts#put-the-tabs-in-your-own-order`, a heading owned by the
`remote-hosts` rewriter in this wave and not frozen. It now links to
`/remote-hosts` (the page), and the drag-order fact is stated in words.

## Moved

Nothing moved off this page. Per plan §4 the multi-host engine and the
whole-chain connection reading stay on `remote-hosts` and the Conductor itself
stays on `conductor`; this page keeps only what the phone shows, and links.

## Cut

| Fact | Tag |
| --- | --- |
| "not as a cut-down view but as the same workspace" set piece | house rhetoric |
| "A desktop browser made narrow is *not* the same as a real phone", with emphasis capitals/italics (the fact that kolu keys off the pointer is kept) | rhetoric; fact kept |
| "It's neither the phone's single tile nor the desktop's mouse-driven canvas" | house rhetoric ("not X but Y") |
| "opening kolu on a phone **no longer** reshapes every terminal" | history (restated as a plain statement) |
| The desktop canvas and split panel having separate layout owners from the touch drawer; their gestures and sizing rebuilt at that boundary; phone and compact sharing the terminal view and drawer | implementation |
| "the same vocabulary as desktop" as an aside, and the parenthetical "so an amber 'kaval down' reads the same on a phone" | duplicate (`remote-hosts` owns the pip reading; the link stays) |
| "A phone is narrower than the width where kolu can stand the work in progress beside the conversation" | implementation (the reader sees the one column) |
| Your own messages sitting at the column's right edge | visible on screen |
| The identity colour a chip wears when its host is active; the pip's green / amber / red wording; "always-on"; the add-machine section being full-width | visible on screen |
| The Conductor tab being "visibly not one of them"; the violet dot with no number when it asks with nothing in flight; the conversation sitting in "one column" | visible on screen |
| "with the Conductor lit and no host lit" when the sheet opens from the Conductor | visible on screen |
| The pull handle reading **◆ Conductor**; the badge counting pieces of work and turning needs-you violet; the sheet opening as it does from a host | duplicate (`conductor`) |
| The conversation kept as you left it (open panels, place in transcript, half-typed message) | duplicate (`conductor`) |
| The watched-terminals panel and its **N pieces of work · M terminals** status line, absent when nothing is watched | duplicate (`conductor`) |
| The one-line growing composer with **Send**, and the steer hint on the status line | duplicate (`conductor`) |
| "the terminal is kept, not attached again" when switching layouts | implementation |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `watching 0` | cut: it was the example of what is not printed. The page still says the count is absent when nothing is watched. |
