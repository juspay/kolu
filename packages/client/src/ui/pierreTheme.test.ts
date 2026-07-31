import { describe, expect, it } from "vitest";
import { pierreTreesShadowCss } from "./pierreTheme";

describe("pierreTreesShadowCss", () => {
  it("tints every ancestor row Pierre marks as containing a git change", () => {
    expect(pierreTreesShadowCss).toMatch(
      /\[data-item-contains-git-change='true'\] > \[data-item-section='content'\]\s*\{\s*color: var\(--trees-git-modified-color\);\s*\}/,
    );
  });
});
