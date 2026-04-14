/** Theme management — preview/commit lifecycle, independent of terminal CRUD. */

import { createSignal, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import { pickVariegatedTheme } from "./themePicker";
import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common";

export interface ThemeManagerDeps {
  activeId: Accessor<TerminalId | null>;
  getThemeName: (id: TerminalId) => string | undefined;
  setThemeName: (id: TerminalId, name: string) => void;
}

let cached: ReturnType<typeof init> | undefined;

function init(deps: ThemeManagerDeps) {
  const committedThemeName = createMemo(() => {
    const id = deps.activeId();
    return (id !== null && deps.getThemeName(id)) || DEFAULT_THEME_NAME;
  });

  const [previewThemeName, setPreviewThemeName] = createSignal<
    string | undefined
  >(undefined);

  const activeThemeName = createMemo(
    () => previewThemeName() ?? committedThemeName(),
  );

  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  function getTerminalTheme(id: TerminalId): ITheme {
    const preview = deps.activeId() === id ? previewThemeName() : undefined;
    return getThemeByName(preview ?? deps.getThemeName(id));
  }

  function handleSetTheme(themeName: string) {
    const id = deps.activeId();
    if (id === null) return;
    deps.setThemeName(id, themeName);
  }

  /** Shuffle the active terminal to a uniformly-random different theme. */
  function handleRandomizeTheme() {
    const id = deps.activeId();
    if (id === null) return;
    const current = deps.getThemeName(id);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    handleSetTheme(pick.name);
  }

  /** Shuffle the active terminal to a theme whose background is perceptually
   *  far from the current one (and, if desired, from other terminals). Uses
   *  the same variegated picker as new-terminal creation so repeated
   *  invocations walk the palette instead of hovering near the current
   *  colour. Filtering the current theme out of `candidates` guarantees a
   *  distinct name even when tie-breaking doesn't favour us. */
  function handleVariegateTheme() {
    const id = deps.activeId();
    if (id === null) return;
    const current = deps.getThemeName(id);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const currentBg = getThemeByName(current).background;
    const usedBgs = currentBg ? [currentBg] : [];
    handleSetTheme(pickVariegatedTheme(candidates, usedBgs));
  }

  return {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme: () => previewThemeName() !== undefined,
    handleSetTheme,
    handleRandomizeTheme,
    handleVariegateTheme,
  } as const;
}

export function useThemeManager(deps: ThemeManagerDeps) {
  if (!cached) cached = init(deps);
  return cached;
}
