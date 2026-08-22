/** padi's half of `screen.image`: the theme is resolved HERE.
 *
 *  Layout, palette and SVG are covered by `terminal-snapshot`'s own tests, and
 *  the CAPTION is no longer padi's at all — it is `terminalCaption` in
 *  `@kolu/terminal-vocab`, tested beside the projection it reads, because the
 *  browser draws the same string on the same title bar. What is padi-specific,
 *  and therefore tested here, is that the terminal's OWN theme reaches the
 *  picture. That test drives `renderScreenImage` end to end (real fonts, real
 *  rasteriser) rather than rebuilding a scene beside it: a test that
 *  hand-assembles the pipeline it is meant to be checking stays green while the
 *  pipeline rots. */

import { describe, expect, it } from "vitest";
import type { SnapshotGrid } from "terminal-snapshot";
import { SCREEN_CELLS_MAX_ROWS } from "kaval";
import { SCREEN_IMAGE_MAX_ROWS } from "./surface.ts";
import { renderScreenImage } from "./screenImage.ts";

const gridWith = (fg: number): SnapshotGrid => ({
  cols: 4,
  lines: [
    {
      cells: [
        {
          col: 0,
          chars: "x",
          width: 1,
          fg: { kind: "palette", index: fg },
          bg: { kind: "default" },
          bold: false,
          italic: false,
          dim: false,
          underline: false,
          inverse: false,
        },
      ],
    },
  ],
});

describe("theme resolution reaches the picture", () => {
  // Through `renderScreenImage` itself, not through a scene rebuilt here with
  // parameters no production caller uses. The pair this replaced hand-called
  // `buildScene`/`sceneToSvg` and asserted a `terminal-snapshot` /
  // `terminal-themes` property — green whatever padi did, including if this
  // module stopped passing the theme along at all.
  it("renders the SAME cell differently under two themes", async () => {
    // The whole reason rendering lives in padi rather than kaval: the cells say
    // "palette 1", and only this side knows what colour that is. If the theme
    // did not reach the renderer, these two would be byte-identical.
    const render = (themeName: string | undefined) =>
      renderScreenImage({ grid: gridWith(1), themeName, label: "t" });

    const [a, b] = await Promise.all([
      render("Tomorrow Night"),
      render("Nord"),
    ]);
    expect(a.data).not.toBe(b.data);
    // And the reply describes the grid it actually rendered.
    expect(a.mimeType).toBe("image/png");
    expect(a.cols).toBe(4);
    expect(a.rows).toBe(1);

    // An unknown name is kolu's default theme rather than a failed screenshot —
    // `getThemeByName`'s documented behaviour, asserted where padi relies on it.
    const unknown = await render("no-such-theme");
    const absent = await render(undefined);
    expect(unknown.data).toBe(absent.data);
  });
});

describe("the row ceiling is one number, spelled twice on purpose", () => {
  it("padi's ceiling equals kaval's", () => {
    // `surface.ts` is browser-safe and cannot import kaval's package — its
    // barrel re-exports a node-pty child — so the constant is duplicated the
    // way `vocab.ts` duplicates kaval's schemas. This test is the seam that
    // makes the duplicate safe, and it lives here because a padi *test* is on
    // the node side of that seal where importing kaval is free.
    //
    // If they ever drift, an explicit `lines` legal to padi's schema dies as a
    // kaval decode error instead — which is the refuse-vs-trim split collapsing
    // into whichever layer happens to be tighter.
    expect(SCREEN_IMAGE_MAX_ROWS).toBe(SCREEN_CELLS_MAX_ROWS);
  });
});
