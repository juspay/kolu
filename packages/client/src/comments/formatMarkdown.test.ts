import { describe, expect, it } from "vitest";
import { formatMarkdown } from "./formatMarkdown";
import type { Comment } from "./types";

const mk = (path: string, quote: string, body: string, id = "x"): Comment => ({
  id,
  path,
  locator: { quote, prefix: "", suffix: "" },
  body,
  createdAt: 0,
});

describe("formatMarkdown", () => {
  it("returns empty string for empty queue", () => {
    expect(formatMarkdown([])).toBe("");
  });

  it("renders one comment as path + quote + body, no envelope wrapper", () => {
    const out = formatMarkdown([mk("a.md", "hello", "fix this")]);
    expect(out).toBe('- a.md\n  > "hello"\n  fix this');
    expect(out).not.toMatch(/\[kolu comments/);
  });

  it("renders multiple comments separated by blank lines", () => {
    const out = formatMarkdown([
      mk("a.md", "first", "fix A"),
      mk("b.html", "second", "fix B"),
    ]);
    const blocks = out.split("\n\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("a.md");
    expect(blocks[1]).toContain("b.html");
  });

  it("collapses newlines inside the quote to spaces", () => {
    const out = formatMarkdown([mk("a.md", "line1\nline2\nline3", "comment")]);
    expect(out).toContain('> "line1 line2 line3"');
  });

  it("omits the body section when body is empty", () => {
    const out = formatMarkdown([mk("a.md", "q", "   ")]);
    expect(out).toBe('- a.md\n  > "q"');
  });
});
