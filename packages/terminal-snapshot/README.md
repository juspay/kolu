# terminal-snapshot

A terminal screen as a **picture**. Hand it a grid of cells and a theme, get back flat drawing instructions — rectangles, positioned glyphs, window chrome — that any backend can execute. A **leaf** in the `terminal-themes` / [`@kolu/terminal-protocol`](../terminal-protocol/README.md) tier: it hides a bounded algorithm (grid + theme → what goes where, in what colour), not a volatility, so it is a plain workspace package rather than a `@kolu/*` receptacle.

Kolu draws this picture from two places that share nothing else. The browser paints it onto a canvas for the copy-screenshot-to-clipboard action; the daemon emits it as SVG and rasterises it for `kolu screenshot` and the `screen_image` MCP tool. The scene is the intermediate that keeps them honest.

## Why there is an IR at all

The obvious shape — a canvas painter in the client, an SVG writer in padi — has both sides deciding the same things: which colour `palette 4` is under this theme, where the title bar ends and the grid starts, whether reverse-video swaps before or after the theme default is applied. Two answers held in agreement by prose is exactly the drift Kolu's docs keep having to describe after the fact.

So the layout is decided **once**, in `buildScene`, and the two backends are dumb executors of that answer. "The user's screenshot and the agent's screenshot are the same picture" is then true **by construction**, not by review.

```
  @xterm/headless buffer (daemon)  ─┐
                                    ├─► readGrid ─► SnapshotGrid ─┐
  @xterm/xterm buffer (browser)    ─┘                              │
                                                                   ├─► buildScene ─► SnapshotScene
                                       terminal-themes ITheme ────┘                      │
                                                                                          ├─► canvas painter (client)
                                                                                          └─► sceneToSvg ─► resvg ─► PNG (padi)
```

`readGrid` reads its buffer **structurally**: `@xterm/headless`'s `IBufferCell` and `@xterm/xterm`'s both satisfy `ReadableCell` without either package being a dependency here. That is what lets one renderer serve a headless daemon and a live browser tab.

The one thing a scene deliberately does **not** carry is glyph metrics. `cellW`/`cellH` are *inputs*, because only the backend can measure the font it will actually draw with — the browser with `measureText`, the daemon from the font file's own advance width.

## Two entry points

| Entry | What it is | Who imports it |
| --- | --- | --- |
| `terminal-snapshot` | Pure and **browser-safe**: no canvas, no DOM, no `node:` anything, no fonts. `readGrid` (buffer → `SnapshotGrid`), `buildScene` (grid + theme → `SnapshotScene`), `resolveTheme`, `sceneToSvg`, and the `CHROME` geometry both backends frame the window with. | the client's `screenshotTerminal.ts`, padi |
| `terminal-snapshot/png` | **Node-only.** `sceneToPng` — the scene as SVG, rasterised by [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) — plus the `PNG_FONT_FAMILY` / `PNG_CELL_WIDTH_RATIO` the caller must build the scene with. | padi's `screen.image` |

The split is the point of the second entry: the browser has a canvas and needs none of the rasteriser, so the wasm module and the font reads must not be reachable from the root import.

**wasm, not a native binding.** `@resvg/resvg-wasm` rather than `@resvg/resvg-js` or `@napi-rs/canvas`, because the daemon ships as TypeScript sources run from the Nix store: a prebuilt `.node` binary would need a per-platform artifact in a tree that builds for `x86_64-linux` and `aarch64-darwin` from one lockfile, where a `.wasm` is the same bytes everywhere.

**SVG in the middle, not a direct raster.** An SVG document is a pure string, so a layout change shows up as a readable text diff in a golden file — a golden PNG only ever says "some pixels differ".

## Fonts are baked, and their absence crashes

The daemon backend does **no** system font discovery (`loadSystemFonts: false`). It draws with exactly the faces `KOLU_SNAPSHOT_FONTS_DIR` names — Kolu's own FiraCode Nerd Font first, then Symbols Nerd Font, DejaVu Sans Mono and the two Noto symbol faces — baked by Nix (`nix/packages/fonts`). A missing directory or a missing face **throws**: a screenshot rendered in a substitute font would look plausible and be wrong, which is the silent degradation Kolu's fail-fast rule exists to prevent.

**CJK and emoji render as tofu** (empty boxes). That stack covers Latin, box drawing, powerline and Nerd Font icons, the braille spinner frames, and the misc-technical glyphs an agent TUI leans on — `⎿`, the connector Claude Code draws under every tool call. It carries no CJK or emoji face, because adding one would put tens of megabytes of font into the daemon's Nix closure. The cells are still *correct* — `SnapshotCell.width` carries the VT display width, so a wide glyph occupies its two columns — only the shapes are missing.

## Design notes

- **One `<text>` per cell, in both backends.** Not a missed batching optimisation: a run drawn as one string lets the font's shaper apply ligatures and kerning across cell boundaries, which visibly slides FiraCode's `!=` and `=>` off the grid. A terminal is a grid, and one positioned draw per cell is what keeps it one.
- **Cells carry attributes, not pixels.** A colour in a `SnapshotCell` is what the escape sequence *said* (`palette 4`, `rgb 0x00ff88`, or "default"), never a CSS string — "what default means" is a theme question, and the mirror that produced the cells has no theme. Likewise reverse-video is kept as the attribute and swapped once in `buildScene`, so a consumer that wants the raw fact still has it.
- **Blank cells are omitted.** A terminal screen is mostly empty, so a row is typically a handful of cells — which is what keeps a grid cheap enough to put on a wire (kaval's `terminal.getScreenCells`).
- **XML-illegal code points are dropped, not escaped.** A single stray control byte in the scrollback would otherwise make the SVG unparseable and fail every screenshot of that terminal.

`src/scene.test.ts` pins the layout contract; `src/render.smoke.ts` is the manual smoke — it drives a real headless buffer through the whole pipeline and writes a PNG you can look at (`node --import tsx packages/terminal-snapshot/src/render.smoke.ts /tmp/out.png`, with the font directory on the environment).
