/** Theme management — preview/commit lifecycle, independent of terminal CRUD.
 *
 *  Singleton: pulls live state from `useTerminalStore`, mutates server
 *  state via the typed RPC client directly. Callers (App.tsx, palette,
 *  pill swatches) just call `useThemeManager()` — no deps to wire. */

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
} from "terminal-themes";
import { client } from "./rpc/rpc";
import { useTerminalStore } from "./terminal/useTerminalStore";

function init() {
  const store = useTerminalStore();
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

  function getTerminalTheme(id: TerminalId): ITheme {
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
