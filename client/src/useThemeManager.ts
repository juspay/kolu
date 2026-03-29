/** Theme management — preview/commit lifecycle, independent of terminal CRUD. */

import { createSignal, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import type { TerminalId } from "kolu-common";

let cached: ReturnType<typeof createThemeManager> | undefined;

function createThemeManager(deps: {
  activeId: Accessor<TerminalId | null>;
  getThemeName: (id: TerminalId) => string | undefined;
  setThemeName: (id: TerminalId, name: string) => void;
}) {
  /** The active terminal's committed theme name (for palette filter — not affected by preview). */
  const committedThemeName = createMemo(() => {
    const id = deps.activeId();
    return (id !== null && deps.getThemeName(id)) || DEFAULT_THEME_NAME;
  });

  /** Temporary preview override while navigating the theme palette. */
  const [previewThemeName, setPreviewThemeName] = createSignal<
    string | undefined
  >(undefined);

  /** The displayed theme name: preview if active, otherwise committed. */
  const activeThemeName = createMemo(
    () => previewThemeName() ?? committedThemeName(),
  );

  /** The active terminal's resolved theme (for container background). */
  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  /** Resolve the display theme for a terminal, applying preview override for the active one. */
  function getTerminalTheme(id: TerminalId): ITheme {
    const preview = deps.activeId() === id ? previewThemeName() : undefined;
    return getThemeByName(preview ?? deps.getThemeName(id));
  }

  /** Set the theme for the active terminal, persisting to server. */
  function handleSetTheme(themeName: string) {
    const id = deps.activeId();
    if (id === null) return;
    deps.setThemeName(id, themeName);
  }

  /** Switch the active terminal to a random theme (different from current). */
  function handleRandomizeTheme() {
    const id = deps.activeId();
    if (id === null) return;
    const current = deps.getThemeName(id);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    handleSetTheme(pick.name);
  }

  return {
    committedThemeName,
    previewThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme: () => previewThemeName() !== undefined,
    handleSetTheme,
    handleRandomizeTheme,
  };
}

export function useThemeManager(
  deps: Parameters<typeof createThemeManager>[0],
) {
  if (!cached) cached = createThemeManager(deps);
  return cached;
}
