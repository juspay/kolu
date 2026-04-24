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
import type { TerminalId, TerminalMetadata, ThemeMode } from "kolu-common";
import { client } from "./rpc/rpc";
import { useColorScheme } from "./settings/useColorScheme";
import { useTerminalStore } from "./terminal/useTerminalStore";

export function effectiveThemeNameForMode(
  meta:
    | Pick<TerminalMetadata, "lightThemeName" | "darkThemeName">
    | null
    | undefined,
  mode: ThemeMode,
): string {
  if (mode === "light") {
    return meta?.lightThemeName ?? meta?.darkThemeName ?? DEFAULT_THEME_NAME;
  }
  return meta?.darkThemeName ?? meta?.lightThemeName ?? DEFAULT_THEME_NAME;
}

function init() {
  const store = useTerminalStore();
  const { resolvedColorScheme } = useColorScheme();
  const getMeta = (id: TerminalId) => store.getMetadata(id);

  const committedThemeName = createMemo(() => {
    const id = store.activeId();
    return id !== null
      ? effectiveThemeNameForMode(getMeta(id), resolvedColorScheme())
      : DEFAULT_THEME_NAME;
  });

  const [themePickerMode, setThemePickerModeState] = createSignal<ThemeMode>(
    resolvedColorScheme(),
  );
  const [previewTheme, setPreviewTheme] = createSignal<
    { mode: ThemeMode; name: string } | undefined
  >(undefined);

  const activeThemeName = createMemo(() => {
    const preview = previewTheme();
    return preview && preview.mode === resolvedColorScheme()
      ? preview.name
      : committedThemeName();
  });

  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  function committedThemeNameForMode(mode: ThemeMode): string {
    const id = store.activeId();
    return id !== null
      ? effectiveThemeNameForMode(getMeta(id), mode)
      : DEFAULT_THEME_NAME;
  }

  function getEffectiveThemeName(id: TerminalId): string {
    const meta = getMeta(id);
    const preview = store.activeId() === id ? previewTheme() : undefined;
    return preview && preview.mode === resolvedColorScheme()
      ? preview.name
      : effectiveThemeNameForMode(meta, resolvedColorScheme());
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

  function handleSetTheme(themeName: string) {
    const id = store.activeId();
    if (id === null) return;
    setThemeName(id, themePickerMode(), themeName);
  }

  function setPreviewThemeName(name: string | undefined) {
    if (!name) {
      setPreviewTheme(undefined);
      return;
    }
    setPreviewTheme({ mode: themePickerMode(), name });
  }

  function setThemePickerMode(mode: ThemeMode) {
    setPreviewTheme(undefined);
    setThemePickerModeState(mode);
  }

  function resetThemePickerMode() {
    setThemePickerMode(resolvedColorScheme());
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
    const current = effectiveThemeNameForMode(getMeta(id), mode);
    const candidates = availableThemes.filter((t) => t.name !== current);
    if (candidates.length === 0) return;
    const excludeBgs = resolveThemeBgs(store.terminalIds(), (terminalId) =>
      effectiveThemeNameForMode(getMeta(terminalId), mode),
    );
    setThemeName(id, mode, pickTheme(candidates, { excludeBgs }));
  }

  return {
    committedThemeName,
    committedThemeNameForMode,
    themePickerMode,
    setThemePickerMode,
    resetThemePickerMode,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getEffectiveThemeName,
    getTerminalTheme,
    isPreviewingTheme: () => previewTheme() !== undefined,
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
