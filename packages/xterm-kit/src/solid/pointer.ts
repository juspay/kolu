import { createMediaQuery } from "@solid-primitives/media";

/** True on a coarse (finger) pointer — the modality gate the kit's touch surface
 *  arms on (soft keyboard, tap-vs-scroll, touch scrollback). It is the browser
 *  `(pointer: coarse)` media query: an OS-level fact, not a kolu constant, so the
 *  kit owns its OWN query for terminal touch wiring rather than back-depending on
 *  a consumer's layout module. A consumer's own `(pointer: coarse)` reader (e.g.
 *  kolu's `useMobile` `isTouch`, which also drives *layout*) reads the same OS
 *  fact — one source of truth, two independent readers, no shared kolu value. */
export const isCoarsePointer = createMediaQuery("(pointer: coarse)");
