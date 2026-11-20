import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { useLineSelection } from "./useLineSelection";

const copyTexts = (
  items: ReturnType<ReturnType<typeof useLineSelection>["buildItems"]>,
) => items.flatMap((i) => (i.kind === "copy" ? [i.textToCopy] : []));

describe("useLineSelection", () => {
  it("anchors the menu to the item a selection lands on", () => {
    createRoot((dispose) => {
      const sel = useLineSelection(() => "skills/odu");
      sel.handleSelect({ start: 3, end: 4 }, "skills/odu/SKILL.md");
      expect(sel.path()).toBe("skills/odu/SKILL.md");
      expect(copyTexts(sel.buildItems())).toEqual([
        "skills/odu/SKILL.md",
        "skills/odu/SKILL.md:3-4",
      ]);
      sel.handleSelect({ start: 1, end: 1 }, "skills/odu");
      expect(sel.path()).toBe("skills/odu");
      sel.handleSelect({ start: 3, end: 3 }, "skills/odu/SKILL.md");
      sel.handleSelect({ start: 7, end: 7 });
      expect(copyTexts(sel.buildItems())).toEqual([
        "skills/odu",
        "skills/odu:7",
      ]);
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
