/** Theme management — preview/commit lifecycle, independent of terminal CRUD.
 *
 *  Singleton: pulls live state from `useTerminalStore`, mutates server
 *  state via the typed RPC client directly. Callers (App.tsx, palette,
 *  pill swatches) just call `useThemeManager()` — no deps to wire. */

import { createSignal, createMemo, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import {
  DEFAULT_THEME_NAME,
  availableThemes,
  getThemeByName,
  resolveThemeBgs,
  pickTheme,
  type ITheme,
} from "terminal-themes";
import type { TerminalId, ThemeMode } from "kolu-common";
import { client } from "./rpc/rpc";
import { useColorScheme } from "./settings/useColorScheme";
import { effectiveThemeNameForMode, previewAppliesToMode } from "./themeSlots";
import { useTerminalStore } from "./terminal/useTerminalStore";

function init() {
  const store = useTerminalStore();
  const { resolvedColorScheme } = useColorScheme();
  const getThemeSlots = (id: TerminalId) => store.getMetadata(id)?.themeSlots;

  const committedThemeName = createMemo(() => {
    const id = store.activeId();
    return id !== null
      ? effectiveThemeNameForMode(getThemeSlots(id), resolvedColorScheme())
      : DEFAULT_THEME_NAME;
  });

  const [previewTheme, setPreviewTheme] = createSignal<
    { terminalId: TerminalId; mode: ThemeMode; name: string } | undefined
  >(undefined);

  const activeThemeName = createMemo(() => {
    const activeId = store.activeId();
    return activeId !== null
      ? getEffectiveThemeName(activeId)
      : DEFAULT_THEME_NAME;
  });

  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  function getEffectiveThemeName(id: TerminalId): string {
    const preview = previewTheme();
    return preview?.terminalId === id &&
      previewAppliesToMode(preview.mode, resolvedColorScheme())
      ? preview.name
      : effectiveThemeNameForMode(getThemeSlots(id), resolvedColorScheme());
  }

  function getTerminalTheme(id: TerminalId): ITheme {
    return getThemeByName(getEffectiveThemeName(id));
  }

  function setThemeName(id: TerminalId, mode: ThemeMode, name: string) {
    void client.terminal
      .setTheme({ id, mode, themeName: name })
      .catch((err: Error) =>
        toast.error(`Failed to set theme: ${err.message}`),
      );
  }

  function handleSetTheme(
    terminalId: TerminalId | null,
    mode: ThemeMode,
    themeName: string,
  ) {
    if (terminalId === null) return;
    setThemeName(terminalId, mode, themeName);
  }

  function setPreviewThemeName(
    terminalId: TerminalId | null,
    mode: ThemeMode,
    name: string,
  ) {
    if (terminalId === null) {
      setPreviewTheme(undefined);
      return;
    }
    setPreviewTheme({ terminalId, mode, name });
  }

  function clearPreviewTheme() {
    setPreviewTheme(undefined);
  }

  /** Shuffle the active terminal's current appearance slot to a random theme.
   *  Random — not argmax — because argmax ping-pongs (theme A's farthest
   *  neighbour is theme B, and B's farthest is A, so repeated ⌘J just bounces
   *  between two). Excludes every live terminal's effective bg so we don't land
   *  on a duplicate of a sibling, and stays under the chroma cap so we don't
   *  surface neon yellow. New-terminal creation uses spread mode instead — see
   *  {@link pickTheme} for the rationale. */
  function handleShuffleTheme() {
    const id = store.activeId();
    if (id === null) return;
    const mode = resolvedColorScheme();
    const current = effectiveThemeNameForMode(getThemeSlots(id), mode);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const excludeBgs = resolveThemeBgs(store.terminalIds(), (terminalId) =>
      effectiveThemeNameForMode(getThemeSlots(terminalId), mode),
    );
    setThemeName(id, mode, pickTheme(candidates, { excludeBgs }));
  }

  return {
    setPreviewThemeName,
    clearPreviewTheme,
    activeThemeName,
    activeTheme,
    getEffectiveThemeName,
    getTerminalTheme,
    isPreviewingTheme: () => {
      const preview = previewTheme();
      return (
        preview?.terminalId === store.activeId() &&
        previewAppliesToMode(preview?.mode, resolvedColorScheme())
      );
    },
    handleSetTheme,
    handleShuffleTheme,
    setThemeName,
  } as const;
}

let cached: ReturnType<typeof init> | undefined;

export function useThemeManager() {
  if (!cached) cached = createRoot(() => init());
  return cached;
}
