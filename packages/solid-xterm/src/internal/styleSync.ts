/**
 * Reactive sync of `term.options.theme` and `term.options.fontSize`
 * to Solid-managed accessors. Initial values are skipped (`defer:
 * true`) — they come from the `XTerm` constructor's options on
 * mount. Subsequent reactive changes flow through.
 *
 * Two post-change hooks let the consumer follow up on each axis
 * independently. The typical wiring is:
 *
 *   - `onThemeChange`: clear the WebGL texture atlas (xterm #239
 *     leaves stale glyph atlases after a palette swap, manifesting
 *     as bleed-through color until the next reflow forces a
 *     regeneration).
 *   - `onFontSizeChange`: clear the WebGL texture atlas (same axis)
 *     *and* refit the grid (cell dimensions changed; FitAddon.fit()
 *     must publish the new cols/rows).
 *
 * The hooks are separate because the theme axis has no fit
 * implication — collapsing them into a single `afterChange` would
 * force every consumer to fit-on-theme-swap, which is unnecessary
 * work in the common case.
 *
 * Must be called inside a SolidJS reactive owner (a component body
 * or `runWithOwner` wrapper).
 */

import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import { type Accessor, createEffect, on } from "solid-js";

export interface AttachXtermStyleSyncOptions {
  /** Reactive theme. Pushed into `term.options.theme` on every
   *  change after mount. */
  theme: Accessor<ITheme>;
  /** Reactive font size in CSS pixels. Pushed into
   *  `term.options.fontSize` on every change after mount. */
  fontSize: Accessor<number>;
  /** Optional: called *after* `term.options.theme` is reassigned.
   *  Skipped when `getTerm()` returns null. */
  onThemeChange?: () => void;
  /** Optional: called *after* `term.options.fontSize` is reassigned.
   *  Skipped when `getTerm()` returns null. */
  onFontSizeChange?: () => void;
}

/** Wire two `createEffect(on(..., { defer: true }))` blocks that
 *  forward theme and font-size changes into the live `XTerm`. The
 *  `getTerm` accessor lets callers wire this in before the XTerm
 *  instance exists — the effect bails on null until the consumer
 *  finishes its (typically async) construction path. */
export function attachXtermStyleSync(
  getTerm: () => XTerm | null,
  opts: AttachXtermStyleSyncOptions,
): void {
  createEffect(
    on(
      opts.theme,
      (theme) => {
        const term = getTerm();
        if (!term) return;
        term.options.theme = theme;
        opts.onThemeChange?.();
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      opts.fontSize,
      (size) => {
        const term = getTerm();
        if (!term) return;
        term.options.fontSize = size;
        opts.onFontSizeChange?.();
      },
      { defer: true },
    ),
  );
}
