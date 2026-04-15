/** Theme management — preview/commit lifecycle, independent of terminal CRUD. */

import { createSignal, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import {
  DEFAULT_THEME_NAME,
  availableThemes,
  getThemeByName,
  resolveThemeBgs,
} from "./theme";
import { pickVariegatedTheme } from "./themePicker";
import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common";

export interface ThemeManagerDeps {
  activeId: Accessor<TerminalId | null>;
  /** Live terminal IDs — used by `handleVariegateTheme` to collect peer
   *  backgrounds (every terminal other than the active one) so the
   *  shortcut/palette path matches new-terminal creation semantics:
   *  pick something distinct from every sibling, not just from the
   *  current terminal's own bg. */
  terminalIds: Accessor<TerminalId[]>;
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

  /** Shuffle the active terminal to a theme whose background is perceptually
   *  far from EVERY live terminal (the active one included — keeps us from
   *  shuffling to a near-identical bg). Same semantics as new-terminal
   *  creation, just applied retroactively. Filtering the current theme out
   *  of `candidates` guarantees a distinct name even when tie-breaking
   *  doesn't favour us. */
  function handleShuffleTheme() {
    const id = deps.activeId();
    if (id === null) return;
    const current = deps.getThemeName(id);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const peerBgs = resolveThemeBgs(deps.terminalIds(), deps.getThemeName);
    handleSetTheme(pickVariegatedTheme(candidates, peerBgs));
  }

  return {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme: () => previewThemeName() !== undefined,
    handleSetTheme,
    handleShuffleTheme,
  } as const;
}

export function useThemeManager(deps: ThemeManagerDeps) {
  if (!cached) cached = init(deps);
  return cached;
}
