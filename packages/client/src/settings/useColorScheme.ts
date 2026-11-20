import { toError } from "@kolu/surface/run-stream";
import { makeEventListener } from "@solid-primitives/event-listener";
import { usePrefersDark } from "@solid-primitives/media";
import { Effect } from "effect";
import type { ColorScheme } from "kolu-common/surface";
import { resolveIsDark } from "kolu-common/surface";
import { createEffect, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { wsStatus } from "../rpc/rpc";
import { runAction } from "../runAction";
import { preferences, setViewerMode, updatePreferences } from "../wire";

export type { ColorScheme };

const sharedIsDark = createSharedRoot((): (() => boolean) => {
  const prefersDark = usePrefersDark();
  const memo = createMemo(() =>
    resolveIsDark(preferences().colorScheme, prefersDark()),
  );
  createEffect(() => {
    const dark = memo();
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  });
  const publishViewerMode = () => {
    if (wsStatus() !== "open") return;
    runAction(
      "report viewer mode",
      setViewerMode(prefersDark() ? "dark" : "light").pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(
              `Failed to report viewer mode: ${toError(err).message}`,
            );
          }),
        ),
      ),
    );
  };
  createEffect(publishViewerMode);
  makeEventListener(window, "focus", publishViewerMode);
  makeEventListener(document, "visibilitychange", () => {
    if (!document.hidden) publishViewerMode();
  });
  return memo;
});

export function useColorScheme() {
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  const isDarkMemo = sharedIsDark();

  const isDark = () => isDarkMemo();
  const themeTypeLiteral = (): "light" | "dark" =>
    isDarkMemo() ? "dark" : "light";
  return { colorScheme, setColorScheme, isDark, themeTypeLiteral } as const;
}
