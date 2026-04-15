/** Theme management — preview/commit lifecycle, independent of terminal CRUD. */

import { createSignal, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import {
  DEFAULT_THEME_NAME,
  availableThemes,
  getThemeByName,
  resolveThemeBgs,
  pickTheme,
  type ITheme,
} from "terminal-themes";
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

  /** Shuffle the active terminal to a random theme. Random — not argmax —
   *  because argmax ping-pongs (theme A's farthest neighbour is theme B,
   *  and B's farthest is A, so repeated ⌘J just bounces between two).
   *  Excludes every live terminal's bg so we don't land on a duplicate of
   *  a sibling, and stays under the chroma cap so we don't surface neon
   *  yellow. New-terminal creation uses spread mode instead —
   *  see {@link pickTheme} for the rationale. */
  function handleShuffleTheme() {
    const id = deps.activeId();
    if (id === null) return;
    const current = deps.getThemeName(id);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const excludeBgs = resolveThemeBgs(deps.terminalIds(), deps.getThemeName);
    handleSetTheme(pickTheme(candidates, { excludeBgs }));
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
