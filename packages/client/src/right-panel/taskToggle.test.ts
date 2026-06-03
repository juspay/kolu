import { describe, expect, it } from "vitest";
import { toggleTaskInSource } from "./taskToggle";

describe("toggleTaskInSource", () => {
  it("checks an unchecked box at the given index", () => {
    const src = "- [ ] one\n- [ ] two\n- [ ] three";
    expect(toggleTaskInSource(src, 1)).toBe(
      "- [ ] one\n- [x] two\n- [ ] three",
    );
  });

  it("unchecks a checked box", () => {
    expect(toggleTaskInSource("- [x] done", 0)).toBe("- [ ] done");
    expect(toggleTaskInSource("- [X] done", 0)).toBe("- [ ] done");
  });

  it("counts nested and ordered task items in source order", () => {
    const src = ["- [ ] a", "  - [x] b", "1. [ ] c"].join("\n");
    expect(toggleTaskInSource(src, 1)).toBe(
      ["- [ ] a", "  - [ ] b", "1. [ ] c"].join("\n"),
    );
    expect(toggleTaskInSource(src, 2)).toBe(
      ["- [ ] a", "  - [x] b", "1. [x] c"].join("\n"),
    );
  });

  it("preserves the marker style and trailing text", () => {
    expect(toggleTaskInSource("* [ ] star *bold*", 0)).toBe(
      "* [x] star *bold*",
    );
    expect(toggleTaskInSource("+ [ ] plus", 0)).toBe("+ [x] plus");
  });

  it("does not count a marker `marked` renders as plain text (no checkbox)", () => {
    // `marked` only mints a checkbox when `]` is followed by whitespace AND
    // non-empty text, so `- [ ]typo` (no space — a common author typo) renders
    // as plain text. The two real checkboxes are at indices 0 (design) and 1
    // (build); a click on the first visible one must toggle `design`, NOT the
    // typo line above it.
    const src = "- [ ]typo\n- [ ] design\n- [ ] build";
    expect(toggleTaskInSource(src, 0)).toBe(
      "- [ ]typo\n- [x] design\n- [ ] build",
    );
    expect(toggleTaskInSource(src, 1)).toBe(
      "- [ ]typo\n- [ ] design\n- [x] build",
    );
    // Only two checkboxes render, so index 2 is out of range — the typo line is
    // never reachable.
    expect(toggleTaskInSource(src, 2)).toBeNull();
  });

  it("does not count a bare or whitespace-only marker (renders no checkbox)", () => {
    // `- [ ]` (bare) and `- [ ] ` (trailing space only) both render as plain
    // text in `marked`, so neither is a counted task — index 0 is out of range.
    expect(toggleTaskInSource("- [ ]", 0)).toBeNull();
    expect(toggleTaskInSource("- [ ] ", 0)).toBeNull();
    // A real checkbox after a bare marker is still index 0.
    expect(toggleTaskInSource("- [ ]\n- [ ] real", 0)).toBe(
      "- [ ]\n- [x] real",
    );
  });

  it("respects the CommonMark fence-length rule (shorter inner fence is body)", () => {
    // A ```` block whose body contains a ``` line: CommonMark closes a fence
    // only with a same-char run at least as long as the opener, so the inner
    // ``` is code, not a close. `marked` renders the whole thing as ONE code
    // block plus the single real checkbox after the ```` close — so the scanner
    // must keep `inFence` set through the inner ``` and index that real task at
    // 0. Comparing only the fence char would flip `inFence` off early and count
    // the in-fence `- [ ] still inside` line, drifting the toggle.
    const src = [
      "````",
      "- [ ] inner not a task",
      "```",
      "- [ ] still inside",
      "````",
      "",
      "- [ ] real",
    ].join("\n");
    expect(toggleTaskInSource(src, 0)).toBe(
      [
        "````",
        "- [ ] inner not a task",
        "```",
        "- [ ] still inside",
        "````",
        "",
        "- [x] real",
      ].join("\n"),
    );
    // The only rendered checkbox is the one real task, so index 1 is out of
    // range — no in-fence line is reachable.
    expect(toggleTaskInSource(src, 1)).toBeNull();
  });

  it("ignores `[ ]` inside fenced code blocks", () => {
    const src = [
      "- [ ] real",
      "",
      "```",
      "- [ ] not a task",
      "```",
      "",
      "- [ ] also real",
    ].join("\n");
    // index 1 is the SECOND real task, after the fenced one is skipped
    expect(toggleTaskInSource(src, 1)).toBe(
      [
        "- [ ] real",
        "",
        "```",
        "- [ ] not a task",
        "```",
        "",
        "- [x] also real",
      ].join("\n"),
    );
  });

  it("ignores `[ ]` inside a blockquoted fenced code block", () => {
    // `marked` renders the quoted fence as plain code (no checkbox), so the
    // only checkbox is the real task at index 0. The scan must skip the
    // blockquoted fence too, or its task-looking line drifts the count.
    const src = ["> ```", "> - [ ] not a task", "> ```", "", "- [ ] real"].join(
      "\n",
    );
    expect(toggleTaskInSource(src, 0)).toBe(
      ["> ```", "> - [ ] not a task", "> ```", "", "- [x] real"].join("\n"),
    );
  });

  it("toggles task items inside blockquotes in renderer order", () => {
    // `marked` renders `> - [ ] x` as a real checkbox, so the blockquoted task
    // is index 0 — the scan must see it too, or the count drifts.
    const src = ["> - [ ] inside quote", "", "- [ ] outside"].join("\n");
    expect(toggleTaskInSource(src, 0)).toBe(
      ["> - [x] inside quote", "", "- [ ] outside"].join("\n"),
    );
    expect(toggleTaskInSource(src, 1)).toBe(
      ["> - [ ] inside quote", "", "- [x] outside"].join("\n"),
    );
  });

  it("toggles a task inside a nested blockquote", () => {
    expect(toggleTaskInSource(">> - [ ] deep", 0)).toBe(">> - [x] deep");
  });

  it("toggles a CRLF-encoded task line and preserves the line ending", () => {
    const src = ["- [ ] one\r", "- [ ] two\r", "- [ ] three"].join("\n");
    expect(toggleTaskInSource(src, 1)).toBe(
      ["- [ ] one\r", "- [x] two\r", "- [ ] three"].join("\n"),
    );
  });

  it("returns null when the index is out of range", () => {
    expect(toggleTaskInSource("- [ ] only", 5)).toBeNull();
    expect(toggleTaskInSource("no tasks here", 0)).toBeNull();
  });

  it("skips a leading YAML front-matter block whose value is task-shaped", () => {
    // The renderer strips front matter before assigning `data-md-task`, so the
    // `- [ ] first` under the `todos:` key renders as NO checkbox. Index 0 must
    // therefore toggle the first *body* task, leaving the front matter intact.
    const src = [
      "---",
      "todos:",
      "  - [ ] first",
      "---",
      "",
      "- [ ] real",
    ].join("\n");
    expect(toggleTaskInSource(src, 0)).toBe(
      ["---", "todos:", "  - [ ] first", "---", "", "- [x] real"].join("\n"),
    );
    // There is exactly one rendered checkbox, so index 1 is out of range — the
    // front-matter line is never reachable.
    expect(toggleTaskInSource(src, 1)).toBeNull();
  });

  it("preserves a CRLF front-matter prefix verbatim when toggling the body", () => {
    const src = ["---\r", "title: Hi\r", "---\r", "\r", "- [ ] task"].join(
      "\n",
    );
    expect(toggleTaskInSource(src, 0)).toBe(
      ["---\r", "title: Hi\r", "---\r", "\r", "- [x] task"].join("\n"),
    );
  });

  it("does not mistake a bare `---` (no front matter) for a stripped prefix", () => {
    // A thematic-break `---` mid-document is not a leading front-matter block,
    // so the scan still indexes from the top of the file.
    const src = ["- [ ] a", "", "---", "", "- [ ] b"].join("\n");
    expect(toggleTaskInSource(src, 1)).toBe(
      ["- [ ] a", "", "---", "", "- [x] b"].join("\n"),
    );
  });
});
