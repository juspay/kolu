import type { PadiScreenImageOutput } from "@kolu/padi-client/surface";
import type { SnapshotGrid } from "terminal-snapshot";
import { buildPngScene, sceneToPng } from "terminal-snapshot/png";
import { getThemeByName } from "terminal-themes";

const FONT_SIZE = 15;

const BRAND = "kolu";

export interface ScreenImageInput {
  readonly grid: SnapshotGrid;
  /** The terminal's theme name. An unknown or absent name resolves to kolu's
   *  default theme — `getThemeByName`'s own documented behaviour, and the same
   *  resolution the browser does for the same terminal. */
  readonly themeName: string | undefined;
  readonly label: string;
}

/** Render the grid. Rejects if the font closure is missing or the rasteriser
 *  fails — a screenshot that silently came out in the wrong font would look
 *  plausible and be wrong. The reply's `cols`/`rows` come off the grid itself
 *  rather than off the request, and it is the wire's own reply type so the
 *  renderer and the schema cannot describe two different values. */
export async function renderScreenImage(
  input: ScreenImageInput,
): Promise<PadiScreenImageOutput> {
  const { grid } = input;
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
