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
  is daemon behaviour and rides padi's hashed build closure — this package is a
  `dependencies` edge of `@kolu/padi`, and `PADI_BUILD_ID` is derived from that
  graph. Keep it that way: moving any of the pick maths out of here would move
  code padi executes out of padi's build identity. `themes.json` rides the same
  key (see below) — regenerating it drains every running padi, which is right:
  it is the candidate pool padi picks from.
- **`terminal-themes/color`** — a colour-STRING parser (`parseHexColor` /
  `parseRgbColor` / `parseColor` → `Result<RGB, ColorParseError>`), used by the
  client's screenshot capture. A separate entry point because only the client
  reaches it — padi never loads it at runtime. (It still hashes into
  `PADI_BUILD_ID`: the derived identity is package-granular, so an edit here
  costs one no-op drain. That is the deliberately safe direction — see
  `default.nix`'s `memberIdentityFileset`.)

## Regenerating themes

To rebuild `themes.json` from iTerm2-Color-Schemes:

```sh
cd packages/terminal-themes && just regenerate
```

`themes.json` sits at the package ROOT, outside `src/` — and `PADI_BUILD_ID`
hashes every JSON file at a closure member's root precisely so it cannot slip
the key (`default.nix`'s `memberIdentityFileset`). Regenerating therefore
drains running padis onto the new build, which is the point: the file IS the
pool padi picks each new terminal's theme from.
