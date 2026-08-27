# terminal-themes

Terminal color scheme catalog + perceptual-distance picker. Themes are parsed
from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes)
(Ghostty format) and ship checked-in as `themes.json`.

This is a **declared out-of-repo entry point** (`vendorEntries.ts`): an outside
repo copies this directory out of a content-addressed kolu pin, because a padi
record carries the `themeName` its terminal was created with and a consumer's
live pane should paint that terminal the way kolu paints it rather than in
xterm's washed-out default. It costs one more workspace member — `nonempty` —
and two npm externals a consumer must have installed: `@xterm/xterm` and
`neverthrow`.

## Usage

```ts
import {
  availableThemes,
  DEFAULT_FONT_SIZE,
  FONT_FAMILY,
  getThemeByName,
  resolveThemeBgs,
  pickTheme,
} from "terminal-themes";

// Look up a theme by name
const theme = getThemeByName("Tomorrow Night");

// The two facts about how a kolu terminal is DRAWN, beside the colours it is
// drawn in. Nobody has ever needed one without the other: kolu reads both to
// repaint a buffer for a screenshot, and a consumer painting a padi's terminal
// with this catalog reads both to construct it.
new Terminal({ theme, fontFamily: FONT_FAMILY, fontSize: DEFAULT_FONT_SIZE });

// Pick a theme whose background is maximally distinct from peers
const name = pickTheme(availableThemes, {
  spread: true,
  peerBgs: ["#1d1f21", "#282a36"],
});

// Shuffle to a random theme (for user-triggered ⌘J)
const shuffled = pickTheme(availableThemes, {
  excludeBgs: ["#1d1f21"],
});

// Restrict the pool: light/dark family, or colourful (saturated) tints
const colourful = pickTheme(availableThemes, {
  excludeBgs: ["#1d1f21"],
  mode: "colourful",
});
```

## Regenerating themes

To rebuild `themes.json` from iTerm2-Color-Schemes:

```sh
cd packages/terminal-themes && just regenerate
```
