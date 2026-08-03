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
  // Reached through `wire.ts`'s `setViewerMode` — the one narrowed write ref off
  // kolu's member face — rather than a bound `app.cells.viewerMode.use()`: this
  // browser only WRITES the reading, so a standing subscription on a cell nothing
  // here reads would be pure wire cost. The narrowing lives at the wire seam (one
  // site, fail-loud if the member is absent), not here.
  const publishViewerMode = () => {
    // Never write into a socket that is down. This is a raw `.set`, not a
    // subscription, so nothing in `connectSurfaces` would resubscribe it — a set
    // that rejected because the server was mid-restart would just be a toast, and
    // the server would keep serving the stale reading to every face for the rest
    // of the session.
    if (wsStatus() !== "open") return;
    runAction(
      "report viewer mode",
      setViewerMode(prefersDark() ? "dark" : "light").pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to report viewer mode: ${toError(err).message}`);
          }),
        ),
      ),
    );
  };
  // Tracks BOTH the media query and the transport, so the reading is (re)published
  // on the first connect, on every reconnect, and after a server restart — the
  // server just rewrites the same value, and its scalar `equals` drops it.
  createEffect(publishViewerMode);
  // `viewerMode` is ONE server-wide fact, so with two viewers open (a dark laptop and
  // a light phone) the last writer decides the policy for both. Republishing on focus
  // makes that writer the tab the user is actually in front of — and since a terminal
  // is created from a focused tab, the creating viewer and the daemon agree again.
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
  /** Resolved scheme as a string literal, for libraries that accept
   *  `"dark" | "light"` (e.g. Pierre's `themeType`). */
  const themeTypeLiteral = (): "light" | "dark" =>
    isDarkMemo() ? "dark" : "light";
  return { colorScheme, setColorScheme, isDark, themeTypeLiteral } as const;
}
