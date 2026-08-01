/**
 * UI color scheme (dark/light) — reads from server state.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in,
 * and mirrors the choice into the `color-scheme` CSS property so third-party
 * shadow-DOM widgets (e.g. `@pierre/trees`, `@pierre/diffs`) that use
 * `light-dark()` or form-control theming follow the same resolved scheme.
 * Defaults to "dark" (the app's original palette).
 *
 * Also PUBLISHES the raw OS media-query answer to kolu-server's `viewerMode`
 * cell — the browser is the only face that can observe it, and the server needs
 * it to resolve the new-terminal theme policy for every face (#2045).
 */

import { usePrefersDark } from "@solid-primitives/media";
import type { ColorScheme } from "kolu-common/surface";
import { resolveIsDark } from "kolu-common/surface";
import { createEffect, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { client, preferences, updatePreferences } from "../wire";

export type { ColorScheme };

// One memo + one `<html>` effect + one publish effect across all consumers
// (singleton — see solidjs.md "State per domain"). `createSharedRoot` owns them
// at APP lifetime: the standing media-query listener and the publish effect must
// outlive the first caller's owner, which the old lazy module-level singleton
// did not (they died with whichever component happened to call first).
// HOST-SCOPING: host-INDEPENDENT by design — resolves purely from the
// host-independent `preferences().colorScheme` and a browser media query; no host
// input at all.
const sharedIsDark = createSharedRoot((): (() => boolean) => {
  const prefersDark = usePrefersDark();
  // The SAME resolution kolu-server applies to `viewerMode` when deriving the
  // new-terminal policy (`resolveIsDark` in kolu-common/surface) — one function,
  // two call sites, so the viewer's rendered scheme and the server's derivation
  // cannot drift.
  const memo = createMemo(() =>
    resolveIsDark(preferences().colorScheme, prefersDark()),
  );
  createEffect(() => {
    const dark = memo();
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  });
  // Publish the RAW media-query fact, never the resolved `memo()`: the server
  // owns the `colorScheme` leg of the resolution. Sending an already-resolved
  // "is dark" would put the same derivation in two places, free to drift.
  // Reached through the fully-typed combined link (`client.surface.kolu.*`)
  // rather than a bound `app.cells.viewerMode.use()`: this browser only WRITES
  // the reading, so a standing subscription on a cell nothing here reads would
  // be pure wire cost. (`app.rpc` is `unknown` — the dynamic combined link can't
  // be expanded per-key — and casting it is what `procedureCastGuard` forbids.)
  createEffect(() => {
    const mode = prefersDark() ? "dark" : "light";
    void client.surface.kolu.viewerMode
      .set(mode)
      .catch((err: Error) =>
        toast.error(`Failed to report viewer mode: ${err.message}`),
      );
  });
  return memo;
});

export function useColorScheme() {
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  const isDarkMemo = sharedIsDark();

  const isDark = () => isDarkMemo();
  /** Resolved scheme as a string literal, for libraries that accept
   *  `"dark" | "light"` (e.g. Pierre's `themeType`). */
  const themeTypeLiteral = (): "light" | "dark" =>
    isDarkMemo() ? "dark" : "light";
  return { colorScheme, setColorScheme, isDark, themeTypeLiteral } as const;
}
