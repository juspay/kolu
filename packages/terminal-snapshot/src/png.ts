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

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import {
  buildScene,
  cellHeight,
  type SceneInput,
  type SnapshotScene,
} from "./scene.ts";
import { sceneToSvg } from "./svg.ts";

/** The face every other is a fallback for — named once, and spelled into
 *  {@link PNG_FONT_FAMILY}'s head rather than beside it, so the two cannot
 *  drift. */
const PRIMARY_FACE = "FiraCode Nerd Font Mono";

/** The font family list every glyph is drawn with, most-specific first.
 *
 *  A scene rendered to PNG MUST carry this exact list: resvg falls back along
 *  the family list in the DOCUMENT, not along the order buffers were
 *  registered in. A scene built with a bare `"FiraCode Nerd Font"` renders
 *  tofu for every glyph FiraCode lacks even though the fallback faces are
 *  loaded — measured, not assumed.
 *
 *  MODULE-PRIVATE on purpose: it is applied by {@link buildPngScene}, so a
 *  caller never has to remember to apply it (and cannot get it wrong). */
const PNG_FONT_FAMILY = [
  PRIMARY_FACE,
  "Symbols Nerd Font Mono",
  "DejaVu Sans Mono",
  "Noto Sans Symbols 2",
  "Noto Sans Symbols",
].join(", ");

/** Advance width of one cell as a fraction of the font size, for FiraCode.
 *  The daemon has no `measureText`, and this ratio is a property of the
 *  typeface (600/1000 em by its own metrics, which every FiraCode face
 *  shares), so it is a constant here rather than a per-render measurement.
 *  Module-private for the same reason as {@link PNG_FONT_FAMILY}. */
const PNG_CELL_WIDTH_RATIO = 0.6;

/** Build a scene this backend can actually rasterise.
 *
 *  The ONE entry point the daemon side needs. The font family, the cell
 *  advance and the row height are facts about THIS backend — its baked faces,
 *  its lack of a `measureText` — so they are applied here rather than handed
 *  out as constants for every caller to re-apply identically. Two call sites
 *  used to hand-assemble that recipe, with only one of the three facts checked
 *  and only after the scene existed; a scene built any other way is now
 *  unspellable rather than refused. */
export function buildPngScene(
  input: Omit<SceneInput, "fontFamily" | "cellW" | "cellH">,
): SnapshotScene {
  return buildScene({
    ...input,
    fontFamily: PNG_FONT_FAMILY,
    cellW: input.fontSize * PNG_CELL_WIDTH_RATIO,
    cellH: cellHeight(input.fontSize),
  });
}

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

/** The wasm module, initialised exactly once per process.
 *
 *  Split from the font read deliberately, and the split is load-bearing:
 *  `initWasm` throws "Already initialized" if it is ever called a second
 *  time, so it must NOT sit behind a memo that a failure clears. It did, and
 *  the result was a trap — a font read that failed *after* the wasm was up
 *  cleared the whole memo, and every later screenshot in that process then
 *  re-entered `initWasm` and died with "Already initialized", reporting a
 *  wasm problem for what was actually a missing file. The two have different
 *  retry semantics, so they get different memos: the wasm is a
 *  once-and-for-all fact, the fonts are a read that may legitimately be tried
 *  again. */
let wasmReady: Promise<void> | undefined;

function initRasteriser(): Promise<void> {
  wasmReady ??= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    );
  })();
  return wasmReady;
}

/** The font faces, read once and shared by every render.
 *
 *  Memoised by the PROMISE so concurrent first screenshots share one read
 *  rather than each loading ~9MB. A REJECTED read is dropped from the memo —
 *  a transient failure (a store path not yet realised) is worth retrying, and
 *  unlike the wasm above, re-running this is harmless. */
let fonts: Promise<readonly Uint8Array[]> | undefined;

function loadFonts(): Promise<readonly Uint8Array[]> {
  fonts ??= (async () => {
    // EVERY face in the directory, rather than a re-spelling of the derivation's
    // own list: `nix/packages/fonts/snapshot.nix` is the one authority for which
    // faces exist, and a copy here would only fail at runtime with an ENOENT
    // when the two parted. Order is immaterial — {@link PNG_FONT_FAMILY} is what
    // picks — so the directory carries everything this read needs.
    const dir = fontDir();
    const names = (await readdir(dir)).filter((f) => /\.(?:ttf|otf)$/i.test(f));
    if (names.length === 0) {
      throw new Error(
        `terminal-snapshot: ${dir} holds no font faces — the Nix font closure (nix/packages/fonts) is broken. A screenshot rendered in no font at all is not a degraded render, it is tofu.`,
      );
    }
    return await Promise.all(names.map((f) => readFile(path.join(dir, f))));
  })().catch((cause: unknown) => {
    fonts = undefined;
    throw cause;
  });
  return fonts;
}

/** Render a scene to PNG bytes.
 *
 *  The scene's own `width`/`height` are the raster size — a scene is already
 *  in logical pixels and the daemon has no device pixel ratio to honour, so
 *  there is no scaling decision to make here.
 *
 *  Both wasm handles are freed in a `finally`. They are not garbage — they own
 *  memory inside the wasm heap that the JS collector cannot see, so a daemon
 *  that renders a screenshot every few seconds and never frees them grows
 *  until it is killed.
 *
 *  Takes a scene from {@link buildPngScene}, and the family check below is a
 *  real validation rather than a belt-and-braces assertion. `buildScene` is a
 *  public export, so a caller CAN hand-assemble a scene with a font family of
 *  its own and bring it here — the module-private family list makes that the
 *  awkward path, not an impossible one. The check matters because the failure
 *  it names is silent: resvg falls back along the family list in the DOCUMENT,
 *  not along the order buffers were registered in, so another name renders
 *  tofu for every glyph the first face lacks while still producing a perfectly
 *  valid-looking PNG.
 */
export async function sceneToPng(scene: SnapshotScene): Promise<Uint8Array> {
  if (scene.font.family !== PNG_FONT_FAMILY) {
    throw new Error(
      `terminal-snapshot: a PNG scene must come from buildPngScene, got font family "${scene.font.family}". resvg resolves fallbacks along the document's family list, so another name renders tofu for every glyph the first face lacks — and looks like a valid screenshot while doing it.`,
    );
  }
  const [, fontBuffers] = await Promise.all([initRasteriser(), loadFonts()]);
  const resvg = new Resvg(sceneToSvg(scene), {
    font: {
      fontBuffers: fontBuffers as Uint8Array[],
      defaultFontFamily: PRIMARY_FACE,
      loadSystemFonts: false,
    },
  });
  try {
    const rendered = resvg.render();
    try {
      return rendered.asPng();
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}
