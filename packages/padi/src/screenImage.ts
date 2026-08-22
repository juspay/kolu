/** Render a terminal's screen to a PNG — padi's half of `screen.image`.
 *
 *  The split with kaval is the point of this module. kaval owns the screen
 *  mirror and hands over ATTRIBUTED CELLS: characters plus "palette 4",
 *  "rgb 0x78c8ff", "default". It stops there because turning `palette 4` into
 *  a colour needs a theme, and the theme is a per-terminal user choice that
 *  lives HERE — so this is the only place that can answer. The PTY host stays
 *  free of a wasm rasteriser and several megabytes of font, and the picture
 *  gets made where the palette is known.
 *
 *  Everything below the `buildPngScene` call is shared with the browser's
 *  copy-to-clipboard screenshot (`terminal-snapshot`), so the agent's PNG and
 *  the user's PNG are the same picture by construction. */

import { getThemeByName } from "terminal-themes";
import type { PadiScreenImageOutput } from "./surface.ts";
import type { SnapshotGrid } from "terminal-snapshot";
import { buildPngScene, sceneToPng } from "terminal-snapshot/png";

/** Type size of a rendered screenshot, in CSS pixels.
 *
 *  Larger than the browser's default 14 because this image is read on its
 *  own — often by a model, at whatever scale the host shows it — rather than
 *  in a terminal the reader can zoom. */
const FONT_SIZE = 15;

/** The wordmark stamped in the title bar — the same one the browser's
 *  screenshot stamps. An input to the scene rather than a fact the generic
 *  renderer holds. */
const BRAND = "kolu";

/** What the title bar says. The same `(repo, branch)` projection kolu shows
 *  on a tile, spelled from the metadata padi already holds.
 *
 *  Deliberately NOT an import of `kolu-common`'s `terminalKey`: padi does not
 *  depend on the domain-contract package and should not grow that dependency
 *  for a decoration. The two can disagree only in the fallback arm (no git),
 *  where this shows the directory and the tile shows a shortened path — a
 *  difference in a caption, not in the picture. */
export function screenshotLabel(snapshot: {
  cwd: string;
  git: { repoName: string; branch: string } | null;
}): string {
  if (snapshot.git) return `${snapshot.git.repoName} (${snapshot.git.branch})`;
  const trimmed = snapshot.cwd.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || snapshot.cwd;
}

export interface ScreenImageInput {
  readonly grid: SnapshotGrid;
  /** The terminal's theme name. An unknown or absent name resolves to kolu's
   *  default theme — `getThemeByName`'s own documented behaviour, and the
   *  same resolution the browser does for the same terminal. */
  readonly themeName: string | undefined;
  readonly label: string;
}

/** Render the grid. Rejects if the font closure is missing or the rasteriser
 *  fails — a screenshot that silently came out in the wrong font would look
 *  plausible and be wrong, which is the failure this refuses to ship.
 *
 *  The grid arrives already inside both of kaval's ceilings — the row cap
 *  `SCREEN_IMAGE_MAX_ROWS` mirrors, and the `rows * cols` AREA cap that bounds
 *  the axis no caller can name — and this module deliberately re-checks
 *  neither. The trim happens in kaval's `getScreenCellsFor`, where the grid is
 *  BUILT, which is the only place it can help: a viewport read of a 2,000-row
 *  (or 1,000-column) terminal is past the RPC frame limit and never survives
 *  the hop to be trimmed here. A second trim on this side was unreachable code
 *  kept honest by nothing: the row ceilings are pinned equal by
 *  `screenImage.test.ts`, which is what makes leaning on kaval's safe.
 *
 *  What this module DOES owe the caller is the truth about what it drew, which
 *  is why the reply's `cols`/`rows` come off the grid itself rather than off
 *  the request.
 *
 *  Returns the wire's own reply type, so the renderer and the schema cannot
 *  describe two different values. */
export async function renderScreenImage(
  input: ScreenImageInput,
): Promise<PadiScreenImageOutput> {
  const { grid } = input;
  // The font, the cell advance and the row height are the PNG backend's own
  // facts, applied by `buildPngScene`; what is padi's to say is the theme, the
  // caption and the type size.
  const scene = buildPngScene({
    grid,
    theme: getThemeByName(input.themeName),
    label: input.label,
    brand: BRAND,
    fontSize: FONT_SIZE,
  });
  const png = await sceneToPng(scene);
  return {
    mimeType: "image/png",
    data: Buffer.from(png).toString("base64"),
    cols: grid.cols,
    rows: grid.lines.length,
  };
}
