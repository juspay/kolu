/**
 * Layout seam — single source of truth for "which layout is active" and
 * "is the dock visible". No other file reads `preferences().layoutPin` or
 * the per-layout dock-visibility signals directly; everyone imports from
 * here. This is a named boundary (per `.claude/rules/lowy-volatilities.md`)
 * so changes to layout semantics (breakpoint, pin precedence, new layouts)
 * ripple in exactly one place.
 *
 * Decomposition:
 *  - `layoutPin` / `setLayoutPin` — user intent, server-persisted via
 *    `PreferencesSchema.layoutPin`.
 *  - `currentLayout` — pure memo combining intent + viewport. Never a
 *    `createEffect` that writes back to `layoutPin` (would be an
 *    effect-as-state-machine — see `.claude/rules/hickey-catalog.md`).
 *  - `dockVisible` / `toggleDockVisible` — device-local chrome, NOT
 *    server-persisted. The two values (per-layout) live in `localStorage`
 *    via `makePersisted`. Cross-device sync would treat "I hid the dock on
 *    my phone" as "I want the dock hidden on my desktop too", which isn't
 *    the user's intent; hide-state is a per-device presentation choice.
 *
 * Mobile override: `isMobile()` (<640px) forces compact regardless of pin.
 * The pin is preserved — when the viewport widens, the pin takes effect
 * again. The current toggle in `Header.tsx` cannot produce a canvas pin on
 * mobile since it's hidden via `sm:flex`, but programmatic writes (e.g.
 * onboarding, deep-links) can, and we don't stomp them.
 */

import { createMemo, createRoot, createSignal } from "solid-js";
import { createMediaQuery } from "@solid-primitives/media";
import { makePersisted } from "@solid-primitives/storage";
import { isMobile } from "../useMobile";
import { usePreferences } from "../settings/usePreferences";

/** Viewport width at which canvas becomes the natural layout. Below → compact.
 *  The closed `"canvas" | "compact"` union is a deliberate choice: widening
 *  it later (e.g. an ultra-wide three-column layout) is an intentional
 *  breaking change that forces callers to re-check their handling. */
export const LAYOUT_BREAKPOINT_PX = 1024;

export type Layout = "canvas" | "compact";
export type LayoutPin = "auto" | "canvas" | "compact";

const { preferences, updatePreferences } = usePreferences();

// `createRoot` detaches these from any transient caller's reactive owner so
// they live for the app's lifetime (same pattern as `usePreferences.ts`).
export const { currentLayout, dockVisible, toggleDockVisible, closeDock } =
  createRoot(() => {
    const wideViewport = createMediaQuery(
      `(min-width: ${LAYOUT_BREAKPOINT_PX}px)`,
    );

    // Desktop dock visibility — persisted per layout. Hiding the dock is
    // per-device chrome, not cross-device intent, so it stays in
    // localStorage rather than PreferencesSchema.
    const [canvasDockShown, setCanvasDockShown] = makePersisted(
      createSignal(true),
      { name: "kolu-dock-canvas" },
    );
    const [compactDockShown, setCompactDockShown] = makePersisted(
      createSignal(true),
      { name: "kolu-dock-compact" },
    );

    // Mobile dock visibility — transient, starts hidden. The old
    // `useSidebar` used `createEffect(on(isMobile, ...))` to flip the
    // sidebar on every breakpoint cross; we replace that effect-as-state-
    // machine with a pure memo that reads the right signal per viewport.
    const [mobileDockShown, setMobileDockShown] = createSignal(false);

    const currentLayout = createMemo<Layout>(() => {
      if (isMobile()) return "compact";
      const pin = preferences().layoutPin;
      if (pin !== "auto") return pin;
      return wideViewport() ? "canvas" : "compact";
    });

    /** Bag of {get, set} for the active visibility signal — picked once
     *  per call from `isMobile()` and `currentLayout()`. Centralizes the
     *  three-way switch (mobile / canvas / compact) so toggle and close
     *  share one branch table. */
    const activeVisibility = () => {
      if (isMobile()) return { get: mobileDockShown, set: setMobileDockShown };
      return currentLayout() === "canvas"
        ? { get: canvasDockShown, set: setCanvasDockShown }
        : { get: compactDockShown, set: setCompactDockShown };
    };

    const dockVisible = createMemo<boolean>(() => activeVisibility().get());

    function toggleDockVisible() {
      activeVisibility().set((v) => !v);
    }

    function closeDock() {
      activeVisibility().set(false);
    }

    return { currentLayout, dockVisible, toggleDockVisible, closeDock };
  });

/** Current user pin. Prefer `currentLayout()` unless you specifically need to
 *  distinguish "user pinned canvas" from "viewport gave us canvas". */
export const layoutPin = (): LayoutPin => preferences().layoutPin;

export function setLayoutPin(pin: LayoutPin) {
  updatePreferences({ layoutPin: pin });
}

/** Cycle pin: auto → canvas → compact → auto. For the Header toggle and the
 *  command-palette "Pin layout" entry. */
export function cycleLayoutPin() {
  const next: Record<LayoutPin, LayoutPin> = {
    auto: "canvas",
    canvas: "compact",
    compact: "auto",
  };
  setLayoutPin(next[layoutPin()]);
}
