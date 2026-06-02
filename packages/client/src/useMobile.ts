/** Shared viewport/input-mode signals — singleton.
 *
 *  Two orthogonal axes, never conflated:
 *  - `isMobile` — viewport SIZE (small-screen layout).
 *  - `isTouch`  — input MODALITY (coarse pointer), independent of size.
 *
 *  The size breakpoint has ONE source of truth: Tailwind's `--breakpoint-sm`
 *  theme token (declared in `index.css`, the same value its `sm:` / `max-sm:`
 *  utilities compile against). We read it and build the query as the exact
 *  complement of `sm:` (`width < sm`), so a viewport is "mobile" in JS and
 *  "below sm" in CSS at precisely the same pixel — no off-by-one desync band.
 *  Falls back to Tailwind's default `40rem` (640px) before the stylesheet has
 *  applied (e.g. unit tests with no DOM). */

import { createMediaQuery } from "@solid-primitives/media";

/** Tailwind's `sm` breakpoint, read from the generated CSS custom property so
 *  JS and CSS share one definition of where "mobile" begins. */
const SM_BREAKPOINT =
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
        .getPropertyValue("--breakpoint-sm")
        .trim()
    : "") || "40rem";

/** Reactive signal: true when the viewport is below the `sm` breakpoint — the
 *  exact complement of Tailwind's `sm:` utilities (i.e. `max-sm:`). */
export const isMobile = createMediaQuery(`(width < ${SM_BREAKPOINT})`);

/** Reactive signal: true on touch devices (phones, tablets). */
export const isTouch = createMediaQuery("(pointer: coarse)");
