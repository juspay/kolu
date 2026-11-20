import { tailLines } from "@kolu/padi-client/screenTail";
import { describe, expect, it } from "vitest";
import { readScreenTail } from "./screenTextTail.ts";

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

const CASES: Record<string, { rows: string[]; slack: number }> = {
  "fresh shell": { rows: ["prompt$", ...blank(23)], slack: 24 },
  "fresh shell, grid unknown": { rows: ["prompt$", ...blank(23)], slack: 0 },
  "blank run longer than the slack": {
    rows: [...lines(200), ...blank(90)],
    slack: 24,
  },
  "all blank": { rows: blank(40), slack: 24 },
  "full screen": { rows: lines(500), slack: 24 },
  "interior blanks": {
    rows: ["a", "", "", "b", "", "c", ...blank(10)],
    slack: 24,
  },
  "whitespace rows": { rows: ["x", "y", "   ", "\t", ""], slack: 2 },
  "short buffer": { rows: ["only"], slack: 24 },
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
    expect(b.windows).toEqual([100, 130]);
  });

  it("never reads past the top of a short buffer twice", async () => {
    const b = buffer(["a", "b", ...blank(3)]);
    await readScreenTail(b.read, 40, 24);
    expect(b.windows).toEqual([64]);
  });
});
