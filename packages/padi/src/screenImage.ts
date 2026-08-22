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
 *  Everything below the `buildScene` call is shared with the browser's
 *  copy-to-clipboard screenshot (`terminal-snapshot`), so the agent's PNG and
 *  the user's PNG are the same picture by construction. */

import { getThemeByName } from "terminal-themes";
import { buildScene, type SnapshotGrid } from "terminal-snapshot";
import {
  PNG_CELL_WIDTH_RATIO,
  PNG_FONT_FAMILY,
  sceneToPng,
} from "terminal-snapshot/png";

/** Type size of a rendered screenshot, in CSS pixels.
 *
 *  Larger than the browser's default 14 because this image is read on its
 *  own — often by a model, at whatever scale the host shows it — rather than
 *  in a terminal the reader can zoom. */
const FONT_SIZE = 15;

/** Row height. The same `fontSize * 1.2` the browser backend uses, so a
 *  screenshot of the same screen is the same height from either face. */
const LINE_HEIGHT_RATIO = 1.2;

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

export interface ScreenImage {
  readonly mimeType: "image/png";
  /** Base64 PNG bytes. */
  readonly data: string;
  readonly cols: number;
  readonly rows: number;
}

/** Render the grid. Rejects if the font closure is missing or the rasteriser
 *  fails — a screenshot that silently came out in the wrong font would look
 *  plausible and be wrong, which is the failure this refuses to ship. */
export async function renderScreenImage(
  input: ScreenImageInput,
): Promise<ScreenImage> {
  const scene = buildScene({
    grid: input.grid,
    theme: getThemeByName(input.themeName),
    label: input.label,
    fontFamily: PNG_FONT_FAMILY,
    fontSize: FONT_SIZE,
    cellW: FONT_SIZE * PNG_CELL_WIDTH_RATIO,
    cellH: Math.ceil(FONT_SIZE * LINE_HEIGHT_RATIO),
  });
  const png = await sceneToPng(scene);
  return {
    mimeType: "image/png",
    data: Buffer.from(png).toString("base64"),
    cols: input.grid.cols,
    rows: input.grid.rows,
  };
}
