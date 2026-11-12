/** `screen.text { tail: N }` must answer exactly `tailLines(screen.text {}, N)`.
 *
 *  `readScreenTail` reads windows off a fake buffer that answers the way
 *  kaval's `tail` extent does — the last `window` rows, blank viewport and
 *  all, fewer when the buffer is shorter — and every case is checked against
 *  the fold over the WHOLE text, so the test pins the equivalence rather than
 *  any one expected string. */

import { tailLines } from "@kolu/padi-client/screenTail";
import { describe, expect, it } from "vitest";
import { readScreenTail } from "./screenTextTail.ts";

/** A kaval-shaped tail read over `rows`, counting the reads it served. */
function buffer(rows: readonly string[]) {
  const windows: number[] = [];
  return {
    windows,
    whole: rows.join("\n"),
    read: async (window: number) => {
      windows.push(window);
      return rows.slice(Math.max(0, rows.length - window)).join("\n");
    },
  };
}

const blank = (n: number): string[] => Array.from({ length: n }, () => "");
const lines = (n: number, prefix = "L"): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** The cases, each a buffer and the grid height the record would carry. */
const CASES: Record<string, { rows: string[]; slack: number }> = {
  // A fresh shell: one prompt line, then a whole blank viewport.
  "fresh shell": { rows: ["prompt$", ...blank(23)], slack: 24 },
  // The same, with no grid on the record — the first window is just N.
  "fresh shell, grid unknown": { rows: ["prompt$", ...blank(23)], slack: 0 },
  // More trailing blank rows than the window's slack.
  "blank run longer than the slack": {
    rows: [...lines(200), ...blank(90)],
    slack: 24,
  },
  // Nothing but blank rows.
  "all blank": { rows: blank(40), slack: 24 },
  // Long scrollback, cursor at the bottom of the viewport.
  "full screen": { rows: lines(500), slack: 24 },
  // Blank lines BETWEEN content survive verbatim.
  "interior blanks": {
    rows: ["a", "", "", "b", "", "c", ...blank(10)],
    slack: 24,
  },
  // Whitespace-only rows count as blank, as `tailLines` says.
  "whitespace rows": { rows: ["x", "y", "   ", "\t", ""], slack: 2 },
  // A buffer shorter than any window.
  "short buffer": { rows: ["only"], slack: 24 },
  // An empty buffer.
  empty: { rows: [], slack: 24 },
};

describe("readScreenTail ≡ tailLines over the whole screen", () => {
  for (const [name, { rows, slack }] of Object.entries(CASES)) {
    for (const tail of [1, 2, 5, 40, 1000]) {
      it(`${name}, tail ${tail}`, async () => {
        const b = buffer(rows);
        expect(await readScreenTail(b.read, tail, slack)).toBe(
          tailLines(b.whole, tail),
        );
      });
    }
  }
});

describe("readScreenTail — what a read costs", () => {
  it("reads ONE window when N plus the grid covers the blank viewport", async () => {
    const b = buffer([...lines(5000), "prompt$", ...blank(23)]);
    expect(await readScreenTail(b.read, 40, 24)).toBe(tailLines(b.whole, 40));
    expect(b.windows).toEqual([64]);
  });

  it("widens to the blank run plus N once that run is known — two reads", async () => {
    const b = buffer([...lines(5000), ...blank(90)]);
    await readScreenTail(b.read, 40, 60);
    // 100 rows held 10 content lines under a 90-row blank run: read 90 + 40.
    expect(b.windows).toEqual([100, 130]);
  });

  it("never reads past the top of a short buffer twice", async () => {
    const b = buffer(["a", "b", ...blank(3)]);
    await readScreenTail(b.read, 40, 24);
    expect(b.windows).toEqual([64]);
  });
});
