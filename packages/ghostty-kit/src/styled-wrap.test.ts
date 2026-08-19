import { describe, expect, it } from "vitest";
import { lineCols, lineContinuesPrevious, parseVtStyled } from "./styled.ts";

describe("lineContinuesPrevious", () => {
  it("rejoins a hard-wrapped phrase the way the e2e reader does", () => {
    const cols = 2;
    const lines = parseVtStyled("sp\nli\nt-\nun\niq\nue\n-t\nex\nt", () => 1);
    expect(lineCols(lines[0]!)).toBe(2);
    expect(lineContinuesPrevious(lines, 0, cols)).toBe(false);
    expect(lineContinuesPrevious(lines, 1, cols)).toBe(true);
    expect(lineContinuesPrevious(lines, lines.length - 1, cols)).toBe(true);
    const joined: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i]!;
      const text = row.runs.map((r) => r.text).join("");
      if (lineContinuesPrevious(lines, i, cols) && joined.length > 0) {
        joined[joined.length - 1] += text;
      } else {
        joined.push(text);
      }
    }
    expect(joined.join("\n")).toContain("split-unique-text");
  });
});
