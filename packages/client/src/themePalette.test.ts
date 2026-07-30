import { describe, expect, it, vi } from "vitest";
import type { PaletteAction } from "./CommandPalette";
import { themePaletteGroup } from "./themePalette";

function harness() {
  const setPreviewThemeName = vi.fn();
  const handleSetTheme = vi.fn();
  const group = themePaletteGroup(["Committed", "Preview", "Other"], {
    committedThemeName: () => "Committed",
    setPreviewThemeName,
    handleSetTheme,
  });
  const children =
    typeof group.children === "function" ? group.children() : group.children;
  const preview = children.find(
    (item): item is PaletteAction =>
      item.kind === "action" && item.name === "Preview",
  );
  if (!preview) throw new Error("fixture: Preview action is absent");
  return { group, preview, setPreviewThemeName, handleSetTheme, children };
}

describe("themePaletteGroup", () => {
  it("restores the committed theme when leaving the group or highlighted leaf", () => {
    const { group, preview, setPreviewThemeName } = harness();

    preview.onHighlight?.();
    expect(setPreviewThemeName).toHaveBeenLastCalledWith("Preview");
    preview.onCancel?.();
    expect(setPreviewThemeName).toHaveBeenLastCalledWith(undefined);

    preview.onHighlight?.();
    group.onCancel?.();
    expect(setPreviewThemeName).toHaveBeenLastCalledWith(undefined);
  });

  it("clears the preview before committing the selected theme", () => {
    const { preview, setPreviewThemeName, handleSetTheme } = harness();

    preview.onSelect();

    expect(setPreviewThemeName).toHaveBeenCalledWith(undefined);
    expect(handleSetTheme).toHaveBeenCalledWith("Preview");
    expect(setPreviewThemeName.mock.invocationCallOrder[0]).toBeLessThan(
      handleSetTheme.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("does not offer the already committed theme", () => {
    const { children } = harness();
    expect(
      children.flatMap((item) => ("name" in item ? [item.name] : [])),
    ).toEqual(["Preview", "Other"]);
  });
});
