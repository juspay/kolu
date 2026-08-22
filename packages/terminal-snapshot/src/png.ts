/** Rasterise a {@link SnapshotScene} to a PNG, off the browser.
 *
 *  The node half of the package — kept behind its own `terminal-snapshot/png`
 *  export so the browser, which has a canvas and needs none of this, never
 *  pulls the wasm rasteriser or the font reads into its bundle.
 *
 *  `@resvg/resvg-wasm` (not `@resvg/resvg-js`, not `@napi-rs/canvas`)
 *  because the daemon ships as TypeScript sources run from the Nix store: a
 *  prebuilt native `.node` binary would need a per-platform artifact in a
 *  tree that builds for x86_64-linux and aarch64-darwin from one lockfile,
 *  where a `.wasm` is the same bytes everywhere.
 *
 *  ## Fonts
 *
 *  resvg does no system font discovery here (`loadSystemFonts: false`) — it
 *  gets exactly the faces this module hands it, so the daemon's PNG cannot
 *  quietly change because a host has a different fontconfig. The stack is
 *  chosen by measured coverage, not taste: kolu's own FiraCode Nerd Font
 *  first (it is what the browser draws, and it alone carries the powerline
 *  and private-use icons a shell prompt uses), then DejaVu Sans Mono and the
 *  two Noto symbol faces, which between them supply the glyphs FiraCode
 *  lacks and an agent TUI leans on constantly — the braille spinner frames,
 *  and `⎿`, the connector Claude Code draws under every tool call. */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { SnapshotScene } from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

/** The font family list every glyph is drawn with, most-specific first.
 *
 *  Exported because the scene's `fontFamily` MUST be this list for the
 *  fallbacks to be reachable: resvg falls back along the family list in the
 *  document, not along the order buffers were registered in. A scene built
 *  with a bare `"FiraCode Nerd Font"` renders tofu for every glyph FiraCode
 *  lacks even though the fallback faces are loaded — measured, not assumed. */
export const PNG_FONT_FAMILY =
  "FiraCode Nerd Font Mono, Symbols Nerd Font Mono, DejaVu Sans Mono, Noto Sans Symbols 2, Noto Sans Symbols";

/** Advance width of one cell as a fraction of the font size, for FiraCode.
 *  The daemon has no `measureText`, and this ratio is a property of the
 *  typeface (600/1000 em by its own metrics, which every FiraCode face
 *  shares), so it is a constant here rather than a per-render measurement. */
export const PNG_CELL_WIDTH_RATIO = 0.6;

/** The faces to load, relative to the font root. Order is immaterial —
 *  {@link PNG_FONT_FAMILY} is what picks — but every file here must exist:
 *  a missing face is a broken Nix closure, not a degraded render. */
const FONT_FILES = [
  "FiraCodeNerdFontMono-Regular.ttf",
  "FiraCodeNerdFontMono-Bold.ttf",
  "SymbolsNerdFontMono-Regular.ttf",
  "DejaVuSansMono.ttf",
  "NotoSansSymbols2-Regular.otf",
  "NotoSansSymbols.ttf",
] as const;

/** Where the font files live, baked by Nix.
 *
 *  No PATH search and no bundled-copy fallback: kolu's rule is that a
 *  required value is baked in and its absence CRASHES rather than silently
 *  degrading, and a screenshot rendered in a substitute font is exactly the
 *  silent degradation that rule exists to prevent — it would look plausible
 *  and be wrong. */
function fontDir(): string {
  const dir = process.env.KOLU_SNAPSHOT_FONTS_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_SNAPSHOT_FONTS_DIR is unset — the terminal-snapshot renderer needs the Nix-provided font directory (nix/packages/fonts). It is baked onto the daemon wrapper in default.nix and exported by shell.nix for a dev tree.",
    );
  }
  return dir;
}

/** One process-wide load of the wasm module and the font bytes.
 *
 *  Memoised by the PROMISE, so concurrent first screenshots share one load
 *  rather than racing two `initWasm` calls — `initWasm` throws if it is
 *  called twice. A REJECTED load is dropped from the memo so a transient
 *  read failure doesn't poison every later screenshot in the process. */
let renderer: Promise<readonly Uint8Array[]> | undefined;

function loadRenderer(): Promise<readonly Uint8Array[]> {
  renderer ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasm = await readFile(
      require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
    );
    await initWasm(wasm);
    const dir = fontDir();
    return await Promise.all(
      FONT_FILES.map((f) => readFile(path.join(dir, f))),
    );
  })().catch((cause: unknown) => {
    renderer = undefined;
    throw cause;
  });
  return renderer;
}

/** Render a scene to PNG bytes.
 *
 *  The scene's own `width`/`height` are the raster size — a scene is already
 *  in logical pixels and the daemon has no device pixel ratio to honour, so
 *  there is no scaling decision to make here. */
export async function sceneToPng(scene: SnapshotScene): Promise<Uint8Array> {
  const fontBuffers = await loadRenderer();
  const resvg = new Resvg(sceneToSvg(scene), {
    font: {
      fontBuffers: fontBuffers as Uint8Array[],
      defaultFontFamily: "FiraCode Nerd Font Mono",
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}
