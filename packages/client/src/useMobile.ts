/** Shared viewport/input-mode signals — singleton.
 *  Matches Tailwind's `sm:` breakpoint (640px). */

import { createMediaQuery } from "@solid-primitives/media";

/** Reactive signal: true when viewport is below Tailwind's `sm` breakpoint. */
export const isMobile = createMediaQuery("(max-width: 639px)");

/** Reactive signal: true on touch devices (phones, tablets). */
export const isTouch = createMediaQuery("(pointer: coarse)");
