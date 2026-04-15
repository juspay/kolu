/** Unit tests for `parseNameStatus` — the `git diff --name-status` parser. */

import { describe, it, expect } from "vitest";
import { parseNameStatus } from "./git-review.ts";

describe("parseNameStatus", () => {
  it("parses simple M/A/D lines", () => {
    const raw = "M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\told.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "old.ts", status: "D" },
      { path: "src/bar.ts", status: "A" },
      { path: "src/foo.ts", status: "M" },
    ]);
  });

  it("extracts the new path from renames (R<score>)", () => {
    const raw = "R100\told/path.ts\tnew/path.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "new/path.ts", status: "R" },
    ]);
  });

  it("extracts the destination from copies (C<score>)", () => {
    const raw = "C075\tsrc.ts\tdst.ts\n";
    expect(parseNameStatus(raw)).toEqual([{ path: "dst.ts", status: "C" }]);
  });

  it("handles type-change (T) lines", () => {
    const raw = "T\tlink.txt\n";
    expect(parseNameStatus(raw)).toEqual([{ path: "link.txt", status: "T" }]);
  });

  it("falls back to '?' for unknown status letters", () => {
    const raw = "X\tunknown.txt\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "unknown.txt", status: "?" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\n")).toEqual([]);
  });

  it("sorts output by path", () => {
    const raw = "M\tz.ts\nM\ta.ts\nM\tm.ts\n";
    expect(parseNameStatus(raw).map((f) => f.path)).toEqual([
      "a.ts",
      "m.ts",
      "z.ts",
    ]);
  });

  it("skips blank lines in the middle", () => {
    const raw = "M\tfoo.ts\n\nA\tbar.ts\n";
    expect(parseNameStatus(raw)).toEqual([
      { path: "bar.ts", status: "A" },
      { path: "foo.ts", status: "M" },
    ]);
  });
});
