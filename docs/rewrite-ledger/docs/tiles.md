# tiles

- Kind: how-to. Reader: someone working inside a terminal tile on the canvas.
- Rewritten from: `f50641c6a`
- Words: 1,535 → 984
- Frontmatter: description 152 → 131 characters. No other key changed.

## Headings

| Old | New |
| --- | --- |
| Splits and tabs | Splits and tabs |
| Restarting a terminal in place | Restarting a terminal in place |
| Font zoom | Font zoom |
| Rendering | Rendering |
| Output keeps flowing | Output and resizing |
| A tip under the title bar | A tip under the title bar |
| Folding the tip to a tab | Folding the tip to a tab |
| On touch devices | On touch devices |

Inbound links updated: `website/src/content/changelog/unreleased.mdx` line 54,
`/tiles#output-keeps-flowing` → `/tiles#output-and-resizing`. The other two
inbound anchors (`#a-tip-under-the-title-bar`, `#restarting-a-terminal-in-place`,
from the changelog and `agents`) keep their headings. The outbound link to
`/agents#restarting-a-terminal-onto-the-current-agents` (frozen) is kept.

## Moved

Nothing moved off this page.

## Cut

| Fact | Tag |
| --- | --- |
| "a real xterm.js instance with everything you'd expect from a native one" | implementation |
| The title bar's colour spine makes "identity agree everywhere you look" | visible on screen |
| Nested depth is allowed in the data; the canvas does not invent a second visual language for it | implementation |
| A Dock split row is the same row a top-level terminal gets (indicator, annotation, status words, model, timestamp), opened by a `└` | visible on screen (lives on `dock`) |
| The unfocused pane recedes slightly so the focused one reads as foreground | visible on screen |
| A heartbeat detects a dead connection; reconnecting re-asks for everything the old connection carried | implementation |
| A flooding terminal re-attaches and repaints from a fresh snapshot rather than freezing | implementation |
| Retrying an empty feed happens "at a gentle cadence" | implementation |
| A terminal's screen is drawn for one specific width and height; a pane waits until measured and asks for the screen at its own size; a hidden pane does not state its size | implementation |
| kolu holds a resize redraw back for a moment and then decides: a plain shell's repaint is handed over, an agent's reprint is bigger than a screen so you get the screen | implementation |
| With reduced motion, the tip bar and tab appear without sliding | visible on screen |
| A sleeping tile has no tip | duplicate (a tip needs a running terminal) |
| "Nothing is used up: back at the shell in a repository, the first tip is there again" | duplicate (the bar opens whenever the suggestion applies) |
| The tab comes and goes exactly when the bar would; the rows come back when the bar folds | visible on screen |
| kolu knows the launched agent by its command name | implementation |
| The tile's colour spine beside the monogram | visible on screen |
| A split sits one notch in per hop in the Dock | visible on screen (lives on `dock`) |
| A terminal started before you changed your agents picks the change up here | duplicate (`agents`, linked) |
| WebGL contexts are kept so switching terminals never churns them | implementation |
| "You should never have to nudge a divider to fix a split's rendering" | duplicate (the split paints once when revealed) |
| Font zoom lets you bring two tiles to the same size | rationale |
| A dropped connection is a sleeping laptop or a Wi-Fi roam | implementation |
| The tip bar is coloured and reads as a sentence with buttons in it | visible on screen |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `└` | cut, visible on screen (the Dock's tree drawing) |
| `</kbd>, add tabs with\n<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>` | not a code span: the comparison script reads the two `<kbd>` backticks for <kbd>Ctrl</kbd> + <kbd>`</kbd> as one. Both chords are on the page, unchanged |

## Review round 1

- The split chords used a bare backtick in `<kbd>`, which MDX read as an inline code span across two lines: the rendered page showed `</kbd>, and add tabs with <kbd>…` as code. They are now `<kbd>{"`"}</kbd>`. This bug was on the old page too.
- "working set" (WebGL) rewritten from `packages/client/src/terminal/useTerminalStore.ts`: kept on the most recently used live tiles up to the browser's limit. "feed" → "output".
