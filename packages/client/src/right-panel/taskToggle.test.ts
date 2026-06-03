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

  it("returns null when the index is out of range", () => {
    expect(toggleTaskInSource("- [ ] only", 5)).toBeNull();
    expect(toggleTaskInSource("no tasks here", 0)).toBeNull();
  });
});
