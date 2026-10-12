import { describe, expect, it } from "vitest";
import { itemIdOnPath } from "./CodeView";

describe("itemIdOnPath", () => {
  it("names the rendered item whose element is among the ancestors", () => {
    const first = new EventTarget();
    const second = new EventTarget();
    const inner = new EventTarget();
    const rendered = [
      { id: "skills/odu", element: first },
      { id: "skills/odu/SKILL.md", element: second },
    ];
    expect(itemIdOnPath(rendered, [inner, second])).toBe("skills/odu/SKILL.md");
    expect(itemIdOnPath(rendered, [inner, first])).toBe("skills/odu");
    expect(itemIdOnPath(rendered, [inner])).toBeUndefined();
  });
});
