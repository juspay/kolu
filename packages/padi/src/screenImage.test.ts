import { SCREEN_IMAGE_MAX_ROWS } from "@kolu/padi-client/surface";
import { SCREEN_CELLS_MAX_ROWS } from "kaval";
import type { SnapshotGrid } from "terminal-snapshot";
import { describe, expect, it } from "vitest";
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
  it("renders the SAME cell differently under two themes", async () => {
    const render = (themeName: string | undefined) =>
      renderScreenImage({ grid: gridWith(1), themeName, label: "t" });

    const [a, b] = await Promise.all([
      render("Tomorrow Night"),
      render("Nord"),
    ]);
    expect(a.data).not.toBe(b.data);
    expect(a.mimeType).toBe("image/png");
    expect(a.cols).toBe(4);
    expect(a.rows).toBe(1);

    const unknown = await render("no-such-theme");
    const absent = await render(undefined);
    expect(unknown.data).toBe(absent.data);
  });
});

describe("the row ceiling is one number, spelled twice on purpose", () => {
  it("padi's ceiling equals kaval's", () => {
    expect(SCREEN_IMAGE_MAX_ROWS).toBe(SCREEN_CELLS_MAX_ROWS);
  });
});
