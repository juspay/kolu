/** `tailLines` — the tail-mode slice, pinned apart from the wire. */
import { describe, expect, it } from "vitest";
import { tailLines } from "./screenText.ts";

describe("tailLines", () => {
  it("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("drops the empty line a trailing newline delimits before slicing", () => {
    // tail:1 of "a\nb\n" is "b" — the terminal never renders that empty line.
    expect(tailLines("a\nb\n", 1)).toBe("b");
  });

  it("a tail larger than the text returns the whole text", () => {
    expect(tailLines("a\nb", 10)).toBe("a\nb");
  });

  it("a single line with no newline is itself", () => {
    expect(tailLines("only", 3)).toBe("only");
  });
});
