/** `tailLines` — the tail-mode slice, pinned apart from the wire.
 *
 *  Moved here with the fold itself: a test that imported `@kolu/padi/render`
 *  after the move would pin the RE-EXPORT and go quietly green if the leaf
 *  drifted underneath it. */
import { describe, expect, it } from "vitest";
import { tailLines } from "./screenTail.ts";

describe("tailLines", () => {
  it("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("drops the empty line a trailing newline delimits before slicing", () => {
    // tail:1 of "a\nb\n" is "b" — the terminal never renders that empty line.
    expect(tailLines("a\nb\n", 1)).toBe("b");
  });

  it("drops the whole blank viewport tail — the tail is CONTENT, not empty rows", () => {
    // A rendered buffer ends in the blank rows below the cursor; tail:2 must
    // return the last two content lines, not two empties (the evidence-run
    // regression: tail:6 of a fresh shell returned six blank lines).
    expect(tailLines("prompt$ echo hi\nhi\n\n\n\n\n", 2)).toBe(
      "prompt$ echo hi\nhi",
    );
    // Blank lines BETWEEN content are kept verbatim.
    expect(tailLines("a\n\nb\n\n\n", 3)).toBe("a\n\nb");
  });

  it("a tail larger than the text returns the whole text", () => {
    expect(tailLines("a\nb", 10)).toBe("a\nb");
  });

  it("a single line with no newline is itself", () => {
    expect(tailLines("only", 3)).toBe("only");
  });
});
