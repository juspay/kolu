/** Theme management — preview/commit lifecycle, independent of terminal CRUD.
 *
 *  Singleton: pulls live state from `useTerminalStore`, mutates server
 *  state via the typed RPC client directly. Callers (App.tsx, palette,
 *  pill swatches) just call `useThemeManager()` — no deps to wire. */

import type { TerminalId } from "kolu-common/surface";
import { resolveNewTerminalTheme } from "kolu-common/surface";
import { nonEmpty } from "nonempty";
import { createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import {
  availableThemes,
  DEFAULT_THEME_NAME,
  getThemeByName,
  type ITheme,
  pickTheme,
  resolveThemeBgs,
} from "terminal-themes";
import { createSharedRoot } from "./createSharedRoot";
import { useColorScheme } from "./settings/useColorScheme";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { client, preferences } from "./wire";

function init() {
  const store = useTerminalStore();
  const { isDark } = useColorScheme();
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

  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  /** A tile's resolved theme name before the default fallback: the active
   *  tile's live preview if any, else its committed `themeName` (which may be
   *  unset). Shared by the ITheme and name-string accessors below so the
   *  preview-vs-committed rule lives in exactly one place. */
  function effectiveThemeName(id: TerminalId): string | undefined {
    const preview = store.activeId() === id ? previewThemeName() : undefined;
    return preview ?? getThemeName(id);
  }

  function getTerminalTheme(id: TerminalId): ITheme {
    return getThemeByName(effectiveThemeName(id));
  }

  function getTerminalThemeName(id: TerminalId): string {
    return effectiveThemeName(id) || DEFAULT_THEME_NAME;
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
   *  see {@link pickTheme} for the rationale.
   *
   *  Honors the `newTerminalTheme` preference's light/dark pool (`dark`/
   *  `light`/`auto` restrict the shuffle to that family); `off`/`random`
   *  impose no restriction — ⌘J is an explicit action, so it always shuffles
   *  even when auto-assignment is off. */
  function handleShuffleTheme() {
    const id = store.activeId();
    if (id === null) return;
    const current = getThemeName(id);
    const candidates = nonEmpty(
      availableThemes.filter((t) => t.name !== current),
    );
    if (!candidates) return;
    const excludeBgs = resolveThemeBgs(store.terminalIds(), getThemeName);
    const plan = resolveNewTerminalTheme(
      preferences().newTerminalTheme,
      isDark(),
    );
    const mode = plan.assign ? plan.mode : undefined;
    handleSetTheme(pickTheme(candidates, { excludeBgs, mode }));
  }

  return {
    committedThemeName,
    setPreviewThemeName,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    getTerminalThemeName,
    isPreviewingTheme: () => previewThemeName() !== undefined,
    handleSetTheme,
    handleShuffleTheme,
    setThemeName,
  } as const;
}

export const useThemeManager = createSharedRoot(init);
