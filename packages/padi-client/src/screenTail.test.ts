import { describe, expect, it } from "vitest";
import { tailLines } from "./screenTail.ts";

describe("tailLines", () => {
  it("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("drops the empty line a trailing newline delimits before slicing", () => {
    expect(tailLines("a\nb\n", 1)).toBe("b");
  });

  it("drops the whole blank viewport tail — the tail is CONTENT, not empty rows", () => {
    expect(tailLines("prompt$ echo hi\nhi\n\n\n\n\n", 2)).toBe(
      "prompt$ echo hi\nhi",
    );
    expect(tailLines("a\n\nb\n\n\n", 3)).toBe("a\n\nb");
  });

  it("a tail larger than the text returns the whole text", () => {
    expect(tailLines("a\nb", 10)).toBe("a\nb");
  });

  it("a single line with no newline is itself", () => {
    expect(tailLines("only", 3)).toBe("only");
  });
});
