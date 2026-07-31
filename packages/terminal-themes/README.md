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

// Project theme NAMES onto the backgrounds they RENDER as, ready to feed
// `peerBgs` (see the function's own note on `undefined` names).
const peerBgs = resolveThemeBgs(terminals.map((t) => t.themeName));
```

## Entry points

- **`terminal-themes`** (main) — the catalog, the picker, and the picker's
  colour maths: `availableThemes`, `getThemeByName`, `resolveThemeBgs`,
  `pickTheme`, `DEFAULT_THEME_NAME`, plus the OkLab perceptual distance and the
  light / dark / colourful classification `pickTheme`'s `mode` selects on (all
  in `picker.ts`). Consumed by the kolu client AND by `@kolu/padi`, which
  resolves each new terminal's theme at `createTerminal` — so this entry point
  is daemon behaviour and rides padi's hashed build closure. Keep it that way:
  moving any of the pick maths out of here would move code padi executes out of
  padi's build identity.
- **`terminal-themes/color`** — a colour-STRING parser (`parseHexColor` /
  `parseRgbColor` / `parseColor` → `Result<RGB, ColorParseError>`), used by the
  client's screenshot capture. A separate entry point because only the client
  reaches it; padi's closure never does (see `default.nix`).

## Regenerating themes

To rebuild `themes.json` from iTerm2-Color-Schemes:

```sh
cd packages/terminal-themes && just regenerate
```
