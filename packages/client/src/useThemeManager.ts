/** Theme management — preview/commit lifecycle, independent of terminal CRUD.
 *
 *  Singleton: pulls live state from `useTerminalStore`, mutates server
 *  state via the typed RPC client directly. Callers (App.tsx, palette,
 *  pill swatches) just call `useThemeManager()` — no deps to wire.
 *
 *  Two theme lenses live here so the OS-scheme auto-flip doesn't break
 *  terminal identity:
 *
 *    - **Identity** (`getTerminalIdentityTheme`): always the stored
 *      theme (preview-aware). Used by pill swatches and the minimap
 *      tile color so a terminal you've learned by color stays that
 *      color across OS scheme changes.
 *    - **Render** (`getTerminalTheme` / `activeTheme`): identity, then
 *      passed through `resolveThemeForVariant` when the user has
 *      "Match OS appearance for terminals" on. Used by the terminal
 *      contents and any chrome that wraps them. */

import { usePrefersDark } from "@solid-primitives/media";
import type { TerminalId } from "kolu-common";
import { nonEmpty } from "nonempty";
import { createMemo, createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import {
  availableThemes,
  DEFAULT_THEME_NAME,
  getThemeByName,
  type ITheme,
  pickTheme,
  resolveThemeBgs,
  resolveThemeForVariant,
} from "terminal-themes";
import { client } from "./rpc/rpc";
import { usePreferences } from "./settings/usePreferences";
import { useTerminalStore } from "./terminal/useTerminalStore";

function init() {
  const store = useTerminalStore();
  const { preferences } = usePreferences();
  const prefersDark = usePrefersDark();
  const getThemeName = (id: TerminalId) => store.getMetadata(id)?.themeName;

  const committedThemeName = createMemo(() => {
    const id = store.activeId();
    return (id !== null && getThemeName(id)) || DEFAULT_THEME_NAME;
  });

  const [previewThemeName, setPreviewThemeName] = createSignal<
    string | undefined
  >(undefined);

  const activeThemeName = createMemo(
    () => previewThemeName() ?? committedThemeName(),
  );

  /** Apply OS-scheme variant resolution when the preference is on.
   *  Themes outside any family pair pass through unchanged. */
  function toRenderName(name: string): string {
    if (!preferences().terminalsFollowOSScheme) return name;
    return resolveThemeForVariant(name, prefersDark() ? "dark" : "light");
  }

  const activeTheme = createMemo(() =>
    getThemeByName(toRenderName(activeThemeName())),
  );

  function getTerminalTheme(id: TerminalId): ITheme {
    const preview = store.activeId() === id ? previewThemeName() : undefined;
    const name = preview ?? getThemeName(id) ?? DEFAULT_THEME_NAME;
    return getThemeByName(toRenderName(name));
  }

  function getTerminalIdentityTheme(id: TerminalId): ITheme {
    const preview = store.activeId() === id ? previewThemeName() : undefined;
    return getThemeByName(preview ?? getThemeName(id));
  }

  function setThemeName(id: TerminalId, name: string) {
    void client.terminal
      .setTheme({ id, themeName: name })
      .catch((err: Error) =>
        toast.error(`Failed to set theme: ${err.message}`),
      );
  }

  function handleSetTheme(themeName: string) {
    const id = store.activeId();
    if (id === null) return;
    setThemeName(id, themeName);
  }

  /** Shuffle the active terminal to a random theme. Random — not argmax —
   *  because argmax ping-pongs (theme A's farthest neighbour is theme B,
   *  and B's farthest is A, so repeated ⌘J just bounces between two).
   *  Excludes every live terminal's bg so we don't land on a duplicate of
   *  a sibling, and stays under the chroma cap so we don't surface neon
   *  yellow. New-terminal creation uses spread mode instead —
   *  see {@link pickTheme} for the rationale. */
  function handleShuffleTheme() {
    const id = store.activeId();
    if (id === null) return;
    const current = getThemeName(id);
    const candidates = nonEmpty(
      availableThemes.filter((t) => t.name !== current),
    );
    if (!candidates) return;
    const excludeBgs = resolveThemeBgs(store.terminalIds(), getThemeName);
    handleSetTheme(pickTheme(candidates, { excludeBgs }));
  }

  return {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    getTerminalIdentityTheme,
    isPreviewingTheme: () => previewThemeName() !== undefined,
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
