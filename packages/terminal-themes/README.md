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
```

## Regenerating themes

To rebuild `themes.json` from iTerm2-Color-Schemes:

```sh
just regenerate-themes
```
