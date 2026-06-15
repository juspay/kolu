/** Shared viewport/input-mode signals — singleton.
 *
 *  Two orthogonal axes, never conflated:
 *  - viewport SIZE — small-screen vs. roomy (the `sm` breakpoint).
 *  - input MODALITY — coarse pointer (`isTouch`), independent of size.
 *
 *  These compose into `layoutMode`, the single answer to "which macro layout
 *  do we mount?". Three states:
 *  - `phone`   — below the `sm` breakpoint (iPhone, Z Fold *folded*). One
 *                fullscreen tile.
 *  - `compact` — at/above `sm` AND a finger-driven handheld (Z Fold *unfolded*,
 *                tablets). A two-pane rail + active tile.
 *  - `desktop` — a real (fine) pointer. The spatial pan/zoom canvas.
 *
 *  Why `compact` exists: the desktop spatial canvas and floating Dock are
 *  *mouse* affordances, so a coarse-pointer device gets a touch layout no matter
 *  how wide it is. A Z Fold 6 unfolded reports ~900 CSS px (well past `sm`) yet
 *  is finger-only (`pointer: coarse` + `hover: none`); width alone would have
 *  mis-mounted the desktop canvas on it. So the pointer axis decides
 *  touch-vs-desktop, and width then only chooses phone vs. the roomier compact.
 *
 *  The size breakpoint has ONE source of truth: Tailwind's `--breakpoint-sm`
 *  theme token (declared in `index.css`, the same value its `sm:` / `max-sm:`
 *  utilities compile against). We read it and build the query as the exact
 *  complement of `sm:` (`width < sm`), so a viewport is "below sm" in JS and in
 *  CSS at precisely the same pixel — no off-by-one desync band. Falls back to
 *  Tailwind's default `40rem` (640px) before the stylesheet has applied (e.g.
 *  unit tests with no DOM). */

import { createMediaQuery } from "@solid-primitives/media";

/** Tailwind's `sm` breakpoint, read from the generated CSS custom property so
 *  JS and CSS share one definition of where the small-screen layout begins. */
const SM_BREAKPOINT =
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
        .getPropertyValue("--breakpoint-sm")
        .trim()
    : "") || "40rem";

/** Below the `sm` breakpoint — the exact complement of Tailwind's `sm:`
 *  utilities (i.e. `max-sm:`). True on phones and a Z Fold folded. */
const belowSm = createMediaQuery(`(width < ${SM_BREAKPOINT})`);

/** A finger-driven handheld: the PRIMARY pointer is coarse and cannot hover.
 *  Paired with `hover: none` (not `pointer: coarse` alone) so a hybrid laptop
 *  with a touchscreen *and* a trackpad — whose primary pointer is the fine
 *  trackpad — stays on the desktop layout. Distinct from `isTouch`, which is the
 *  looser input-affordance axis (any coarse primary pointer). */
const handheld = createMediaQuery("(pointer: coarse) and (hover: none)");

export type LayoutMode = "phone" | "compact" | "desktop";

/** Which macro layout to mount — the single fork `App.tsx` keys on. Below `sm`
 *  is always `phone` (preserving the historical "narrow viewport ⇒ phone layout"
 *  rule, mouse or not); at/above `sm` the pointer axis splits a finger-driven
 *  handheld (`compact`) from a real pointer (`desktop`). */
export const layoutMode = (): LayoutMode =>
  belowSm() ? "phone" : handheld() ? "compact" : "desktop";

/** Below `sm` — single fullscreen tile (iPhone, Z Fold folded). */
export const isPhone = () => layoutMode() === "phone";
/** Roomy finger-driven handheld — two-pane rail (Z Fold unfolded, tablets). */
export const isCompact = () => layoutMode() === "compact";
/** Real (fine) pointer — the spatial pan/zoom canvas. */
export const isDesktop = () => layoutMode() === "desktop";

/** Reactive signal: true on touch devices (phones, tablets) — the input
 *  modality axis that tunes tap-target density and soft-keyboard handling,
 *  independent of which layout `layoutMode` mounts. */
export const isTouch = createMediaQuery("(pointer: coarse)");
