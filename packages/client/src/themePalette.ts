import type { PaletteAction, PaletteGroup } from "./CommandPalette";

export interface ThemePaletteDeps {
  committedThemeName: () => string;
  setPreviewThemeName: (name: string | undefined) => void;
  handleSetTheme: (name: string) => void;
}

/** The Set-theme palette state machine, kept pure so preview/cancel/commit
 * behavior is pinned without mounting the whole application. CommandPalette
 * owns when highlight/cancel fire; this owns what each lifecycle edge means. */
export function themePaletteGroup(
  themeNames: readonly string[],
  deps: ThemePaletteDeps,
): PaletteGroup {
  const restore = () => deps.setPreviewThemeName(undefined);
  return {
    kind: "group",
    name: "Set theme",
    section: "active-terminal",
    onCancel: restore,
    children: () =>
      themeNames
        .filter((name) => name !== deps.committedThemeName())
        .map(
          (name): PaletteAction => ({
            kind: "action",
            name,
            // Highlighting a theme row paints the active terminal in it, and
            // the terminal is BEHIND the palette: the dialog drops its
            // backdrop while this row is highlighted.
            previewsBehind: true,
            onHighlight: () => deps.setPreviewThemeName(name),
            onCancel: restore,
            onSelect: () => {
              restore();
              deps.handleSetTheme(name);
            },
          }),
        ),
  };
}
