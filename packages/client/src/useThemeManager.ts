import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { shuffleMode } from "kolu-common/surface";
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
import { runAction } from "./runAction";
import { useColorScheme } from "./settings/useColorScheme";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { activePadiRpc, preferences } from "./wire";

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
    runAction(
      "set theme",
      activePadiRpc.chrome.setTheme({ id, themeName: name }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to set theme: ${toError(err).message}`);
          }),
        ),
      ),
    );
  }

  function handleSetTheme(themeName: string) {
    const id = store.activeId();
    if (id === null) return;
    setThemeName(id, themeName);
  }

  function handleShuffleTheme() {
    const id = store.activeId();
    if (id === null) return;
    const current = getThemeName(id);
    const candidates = nonEmpty(
      availableThemes.filter((t) => t.name !== current),
    );
    if (!candidates) return;
    const excludeBgs = resolveThemeBgs(store.terminalIds(), getThemeName);
    const mode = shuffleMode(preferences().shuffleBehavior, isDark());
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
