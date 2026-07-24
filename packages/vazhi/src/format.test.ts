import { describe, expect, it } from "vitest";
import {
  formatUptime,
  forwardUrl,
  hyperlink,
  readPromptInput,
  viewport,
} from "./format.ts";

describe("formatUptime", () => {
  it.each([
    [0, "0s"],
    [999, "0s"],
    [1_000, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [12 * 60_000, "12m"],
    [59 * 60_000 + 59_000, "59m"],
    [60 * 60_000, "1h 0m"],
    [63 * 60_000, "1h 3m"],
    [25 * 3600_000, "1d 1h"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected);
  });

  it("never renders a negative age (a clock step is not an error to crash on)", () => {
    expect(formatUptime(-5_000)).toBe("0s");
  });
});

describe("readPromptInput", () => {
  it("is still typing while there is no newline", () => {
    expect(readPromptInput("pu-dev:51")).toEqual({
      kind: "typing",
      value: "pu-dev:51",
    });
  });

  it.each([
    "\r",
    "\n",
    "\r\n",
  ])("reads a pasted line ending in %j as a submit", (ending) => {
    // A key at a time, Enter is a key event and never text. A paste (or a
    // harness driving the pty) arrives as ONE event with the newline inside
    // it, and it would otherwise land in the field as a stray character.
    expect(readPromptInput(`pu-dev:5173${ending}`)).toEqual({
      kind: "submit",
      value: "pu-dev:5173",
    });
  });

  it("keeps only what came before the newline", () => {
    expect(readPromptInput("pu-dev:5173\nzest:8080")).toEqual({
      kind: "submit",
      value: "pu-dev:5173",
    });
  });
});

describe("forwardUrl", () => {
  it("names THIS machine, never localhost", () => {
    // "localhost" in a link means the machine of whoever is reading it — the
    // one place the forward is guaranteed not to be.
    expect(forwardUrl("pureintent", 4123)).toBe("http://pureintent:4123");
  });
});

describe("hyperlink", () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);

  it("wraps the URL in an OSC 8 hyperlink", () => {
    expect(hyperlink("http://pureintent:4123")).toBe(
      `${ESC}]8;;http://pureintent:4123${BEL}http://pureintent:4123${ESC}]8;;${BEL}`,
    );
  });

  it("still reads as the plain URL once the escapes are stripped", () => {
    // A terminal that does not speak OSC 8 swallows the sequences and shows
    // exactly this — which is why no capability detection is needed.
    const link = hyperlink("http://pureintent:4123");
    expect(
      link.replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "g"), ""),
    ).toBe("http://pureintent:4123");
  });
});

describe("viewport", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}` }));

  it("shows everything when everything fits", () => {
    const w = viewport({ rows: rows.slice(0, 3), selectedKey: "k1", lines: 5 });
    expect(w.rows).toHaveLength(3);
    expect([w.above, w.below]).toEqual([0, 0]);
  });

  it("always contains the selection", () => {
    for (const key of ["k0", "k9", "k19"]) {
      const w = viewport({ rows, selectedKey: key, lines: 5 });
      expect(w.rows.map((r) => r.key)).toContain(key);
    }
  });

  it("is CONTIGUOUS — never a sample of the list", () => {
    // The defect this exists for: Ink's flex shrink rendered h2, h5, h8, h11…
    const w = viewport({ rows, selectedKey: "k9", lines: 5 });
    const indices = w.rows.map((r) => Number(r.key.slice(1)));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe((indices[i - 1] ?? 0) + 1);
    }
  });

  it("counts what it is hiding on each side", () => {
    const w = viewport({ rows, selectedKey: "k9", lines: 5 });
    expect(w.above + w.rows.length + w.below).toBe(20);
    expect(w.above).toBeGreaterThan(0);
    expect(w.below).toBeGreaterThan(0);
  });

  it("pins to the ends rather than scrolling past them", () => {
    expect(viewport({ rows, selectedKey: "k0", lines: 5 }).above).toBe(0);
    expect(viewport({ rows, selectedKey: "k19", lines: 5 }).below).toBe(0);
  });

  it("keeps the SELECTED row when there is no room for indicators too", () => {
    // A screen that shows only "↑ 9 more" hides the very row `x` acts on.
    for (const lines of [1, 2]) {
      const w = viewport({ rows, selectedKey: "k9", lines });
      expect(w.rows.map((r) => r.key)).toContain("k9");
    }
  });

  it("survives an unknown selection and a zero-height table", () => {
    // Unknown selection anchors at the top; with 5 lines that is 4 rows plus
    // the "more below" indicator.
    expect(viewport({ rows, selectedKey: "gone", lines: 5 }).rows).toHaveLength(
      4,
    );
    expect(viewport({ rows, selectedKey: "k1", lines: 0 }).rows).toHaveLength(
      0,
    );
  });
});
