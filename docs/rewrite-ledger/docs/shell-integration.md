# shell-integration

- Kind: explanation. Reader: someone who wants to know what kolu adds to their shell and where it stops working.
- Rewritten from: `f50641c6a`
- Words: 663 → 652 (plan target 600)
- Frontmatter: `description` 251 → 147 characters. No other key changed.

## Headings

| Old | New |
| --- | --- |
| The three signals | The three signals |
| How it gets into your shell | How it gets into your shell |
| The honest bounds | Limits |
| Next | Next |

No link in the repo points at a `shell-integration` anchor (`grep -rn "shell-integration#"` finds none, and `.waterfall/anchors.md` has no `shell-integration` section), so nothing needed updating. Outbound links checked: `/agent-detection`, `/sessions`, `/kaval` are pages.

## Moved

Nothing.

## Cut

| Fact | Tag |
| --- | --- |
| Losing the `DEBUG` trap "used to cost kolu the first command of every shell"; marks and history tooling "now coexist without either giving anything up" | history (the standing fact, that the first command is where agents get launched and that `PS0` has no contenders, is kept) |
| The command mark is "the quiet load-bearer of the three" | rationale (replaced with "carries the most, but only as a sensor") |
| kolu's daemon reading the sequences is "how a terminal knows things about itself that a raw byte stream can't say" | kept, reworded into the opening |

Everything else on the page is kept: the three signals and their OSC numbers, the sensor-only rule and why a mark can never supply a command, the wrapper replaying your dotfiles first, zsh's `preexec`/`precmd`, bash's `PS0` over the `DEBUG` trap, the history aside, all three limits, and the "nothing leaves your machines" close.

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 1 missing.

| Span | Where it went |
| --- | --- |
| `kaval-tui create --\ncodex` | still here. The old page's span was broken across two source lines, so the comparison script reads it as a different string; the new page spells it `kaval-tui create -- codex` on one line. |
