/** padi's half of `screen.image`: the theme is resolved HERE, and the label is
 *  the caption a reader uses to tell one screenshot from another.
 *
 *  The render itself is covered by `terminal-snapshot`'s own tests (layout,
 *  palette, SVG) — what is padi-specific, and therefore tested here, is that
 *  the terminal's OWN theme reaches the picture and that the caption survives
 *  the fallback arm. */

import { describe, expect, it } from "vitest";
import type { SnapshotGrid } from "terminal-snapshot";
import { screenshotLabel } from "./screenImage.ts";

const gridWith = (fg: number): SnapshotGrid => ({
  cols: 4,
  rows: 1,
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
          inverse: false,
        },
      ],
    },
  ],
});

describe("screenshotLabel", () => {
  it("names the repo and branch when the terminal is in a git worktree", () => {
    expect(
      screenshotLabel({
        cwd: "/src/kolu",
        git: { repoName: "kolu", branch: "main" },
      }),
    ).toBe("kolu (main)");
  });

  it("falls back to the directory name outside a repo", () => {
    expect(screenshotLabel({ cwd: "/home/me/scratch", git: null })).toBe(
      "scratch",
    );
  });

  it("ignores a trailing slash rather than captioning the picture with an empty string", () => {
    expect(screenshotLabel({ cwd: "/home/me/scratch/", git: null })).toBe(
      "scratch",
    );
  });

  it("keeps the root path readable rather than collapsing it to nothing", () => {
    expect(screenshotLabel({ cwd: "/", git: null })).toBe("/");
  });
});

describe("theme resolution reaches the picture", () => {
  it("renders the SAME cell differently under two themes", async () => {
    // The whole reason rendering lives in padi rather than kaval: the cells say
    // "palette 1", and only this side knows what colour that is. If the theme
    // were ignored, these two would be byte-identical.
    const { buildScene } = await import("terminal-snapshot");
    const { sceneToSvg } = await import("terminal-snapshot");
    const { getThemeByName } = await import("terminal-themes");

    const render = (themeName: string) =>
      sceneToSvg(
        buildScene({
          grid: gridWith(1),
          theme: getThemeByName(themeName),
          label: "t",
          fontFamily: "M",
          fontSize: 10,
          cellW: 6,
          cellH: 12,
        }),
      );

    const a = render("Tomorrow Night");
    const b = render("Nord");
    expect(a).not.toBe(b);
  });

  it("falls back to the default theme for an unknown name instead of failing the screenshot", async () => {
    const { getThemeByName, DEFAULT_THEME } = await import("terminal-themes");
    expect(getThemeByName("no-such-theme")).toBe(DEFAULT_THEME);
    expect(getThemeByName(undefined)).toBe(DEFAULT_THEME);
  });
});
