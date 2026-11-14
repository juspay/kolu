# switcher

- Kind: how-to. Reader: someone jumping between terminals, hosts and commands from one search box.
- Rewritten from: `f50641c6a`
- Words: 1,739 → 1,081 (about 160 of these are the three tables, which the counter includes)
- Frontmatter: description 169 → 154 characters. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| What opens at the root | What opens at the root |
| Terminals across every connected host | Terminals from every connected host |
| Browse Terminals: flat list, host-grouped headers | Browse every host's terminals |
| How results rank | How results rank |
| Where the highlight lands | Where the highlight lands (kept; the same-page link still resolves) |
| Deep-link chords | The chords |
| Scoped views (+ Terminals (⌘⇧K / dock search), Hosts (⌘⇧H)) | Scoped views |
| Reading a row | Reading a row |
| What this is not | folded into "Reading a row" and the Next cards |

Inbound links: only the same-page `#where-the-highlight-lands` (updated in place, heading unchanged). No other page links into a `switcher` heading.

Outbound: the two links to `/remote-hosts#put-the-tabs-in-your-own-order` now point at `/remote-hosts`, because that page is rewritten in the same wave and the anchor may not survive.

## Moved

Nothing. The facts this page borrows (the dock's pip language and activity window, the host strip, sessions) already live on `dock`, `remote-hosts` and `sessions`, and are linked.

## Cut

| Fact | Tag |
| --- | --- |
| "one index and one muscle memory"; the chords being deep links "not separate apps" | rationale |
| "one paint vocabulary, not a second colour scheme" | rationale |
| "a split whose parent is gone … is listed rather than lost between the two views" as an argument (the behaviour is kept) | rationale |
| Why the ordering number and the highlight number differ, at length ("what is warm is the right question", "the order shows you what is happening while the highlight keeps pointing home") | rationale |
| "a highlighted row part-way down a list is not a bug" as reassurance (the fact that it sits part-way down is kept) | rationale |
| "a machine list that reshuffles under the cursor is not one you can learn" | rationale |
| "Selecting the row you are already on would be a no-op, so no switcher offers it as the default" | rationale |
| The dock being "glanceable without opening anything" and the host strip being "ambient multi-host status"; ⌘/Super+K not replacing it | duplicate (`dock`, `remote-hosts`) |
| The active host's dock described twice as the pane-level navigator that can land in a split directly | duplicate (`dock`) |
| `showsWorkspaceSwitcher` as the name of the desktop gate | implementation |
| Row paint beyond identity: the monogram being "solid", the repo-coloured spine, the branch hue, the host-hue wash and monogram on group headers, the chip's "hue ring + label" | visible on screen |
| "the same identity hue + connection-status language as the chrome-bar host strip" | visible on screen |
| "Matching is multi-token" as a label for the rule that is then stated plainly | duplicate |
| "scoping is the existing drill-in path (below), not a mode character" as an argument (the absence of sigils is kept) | rationale |
| The breadcrumb as a second way to pop a level (Backspace on an empty query is kept) | visible on screen |
| "The active host's Dock remains the always-on navigator … the switcher is the jump path over the whole fleet", said twice | duplicate (`dock`) |
| "Press it again and you are back — a two-key toggle for terminals and for machines alike" | duplicate (the toggle is stated once) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `max(your last visit, that terminal's own activity)` | kept as prose in "What opens at the root" (`max(your last visit, server activity)`); the second, line-wrapped copy in the cut rationale passage is gone |
| `showsWorkspaceSwitcher` | cut, implementation |

## Review round 1

- Code wins (rule 21): the chord table said <kbd>Mod</kbd> + <kbd>K</kbd> for the root search, with Mod = Ctrl on Linux. `packages/client/src/input/actions.ts:229` binds it to the app modifier: Cmd on a Mac, Super elsewhere. The table and the line under it now say <kbd>Cmd</kbd>/<kbd>Super</kbd> + <kbd>K</kbd> and why (<kbd>Ctrl</kbd> + <kbd>K</kbd> belongs to the shell). The error was on the old page too.
- House style: every chord is now keycaps with modifiers as words; no ⌘⇧ glyphs or bare text.
- "re-keys the canvas" → "switches the canvas to that host".
