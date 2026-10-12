import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { useLineSelection } from "./useLineSelection";

const copyTexts = (
  items: ReturnType<ReturnType<typeof useLineSelection>["buildItems"]>,
) => items.flatMap((i) => (i.kind === "copy" ? [i.textToCopy] : []));

describe("useLineSelection", () => {
  it("anchors the menu to the item a selection lands on", () => {
    // A type-changed path's diff shows the path itself AND the files that
    // used to live under it; a selection on the second item must name that
    // item's file, not the selected row's.
    createRoot((dispose) => {
      const sel = useLineSelection(() => "skills/odu");
      sel.handleSelect({ start: 3, end: 4 }, "skills/odu/SKILL.md");
      expect(sel.path()).toBe("skills/odu/SKILL.md");
      expect(copyTexts(sel.buildItems())).toEqual([
        "skills/odu/SKILL.md",
        "skills/odu/SKILL.md:3-4",
      ]);
      // A range with no item named (a right-click through the frame that
      // resolved no item) keeps the anchor where it is.
      sel.handleSelect({ start: 7, end: 7 });
      expect(copyTexts(sel.buildItems())).toEqual([
        "skills/odu/SKILL.md",
        "skills/odu/SKILL.md:7",
      ]);
      // Selecting back on the path's own item returns the anchor to it.
      sel.handleSelect({ start: 1, end: 1 }, "skills/odu");
      expect(sel.path()).toBe("skills/odu");
      dispose();
    });
  });

  it("drops the anchor and the range when the view's path changes", () => {
    const [scope, setScope] = createSignal("a/b");
    const { sel, dispose } = createRoot((dispose) => ({
      sel: useLineSelection(scope),
      dispose,
    }));
    sel.handleSelect({ start: 2, end: 2 }, "a/b/c");
    expect(sel.path()).toBe("a/b/c");
    setScope("x.ts");
    expect(sel.path()).toBe("x.ts");
    expect(sel.range()).toBeNull();
    dispose();
  });
});
