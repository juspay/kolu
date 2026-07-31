# terminal-themes

Terminal color scheme catalog + perceptual-distance picker. Themes are parsed
from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes)
(Ghostty format) and ship checked-in as `themes.json`.

## Usage

```ts
import {
  availableThemes,
  getThemeByName,
  resolveThemeBgs,
  pickTheme,
} from "terminal-themes";

// Look up a theme by name
const theme = getThemeByName("Tomorrow Night");

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

// Project a set of terminals onto the backgrounds they RENDER as, ready to feed
// `peerBgs`. The selector may return `undefined` for a terminal that has no theme
// set — that is not skipped, it resolves to `DEFAULT_THEME_NAME`'s background,
// because an unthemed terminal is drawn in the default theme.
const peerBgs = resolveThemeBgs(terminals, (t) => t.themeName);
```

## Entry points

- **`terminal-themes`** — the catalog and the picker (`availableThemes`,
  `getThemeByName`, `resolveThemeBgs`, `pickTheme`, `DEFAULT_THEME_NAME`).
  Consumed by the kolu client AND by `@kolu/padi`, which resolves each new
  terminal's theme at `lifecycle.create`.
- **`terminal-themes/color`** — the colour-math leaf (perceptual distance and
  the light/dark/colourful classification the picker's `mode` uses). A separate
  entry point because only the client reaches it; padi's build closure
  deliberately excludes it (see `default.nix`).

## Regenerating themes

To rebuild `themes.json` from iTerm2-Color-Schemes:

```sh
cd packages/terminal-themes && just regenerate
```
