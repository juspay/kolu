/** Resolved view capabilities — named answers to "what feature does this surface
 *  offer?", each computed once from `layoutMode` in `useMobile`.
 *  Feature-availability code asks a capability here instead of re-deriving it
 *  from `layoutMode()` at every call site, so when the form-factor rule for a
 *  capability changes it changes here, not across every consumer. All four
 *  currently key off `isDesktop()` — the spatial canvas exists only with a real
 *  pointer, and tips/switcher/welcome follow the same desktop-only decision —
 *  but each is a distinct capability that can change axis independently. Note
 *  these gate to *desktop only*: a `compact` (touch-tablet) surface inherits the
 *  phone capability profile and differs from phone only in spatial arrangement.
 *
 *  NOT every form-factor read belongs here — only boolean *feature-availability*
 *  gates do. These raw reads are deliberate and stay raw:
 *   - `App.tsx`'s `match(layoutMode())` macro layout fork — the receptacle that
 *     mounts the phone / compact / desktop subtree.
 *   - Layout-specific workarounds keyed on the drawer-hosted layout, e.g.
 *     `CodeTab`'s portaled-tree touch-scroll driver (`!isDesktop()`).
 *   - Diagnostic display of the signal's current value (`DiagnosticInfo`).
 *   - Input-modality behavior keyed on `isTouch` (a separate axis): soft-keyboard
 *     dismissal, tap-target density, the soft-keyboard input surface. */

import { isDesktop } from "./useMobile";

/** The spatial pan/zoom canvas — and the tile commands that act on it
 *  (center-on-active, arrange-by-repo) — exist only on the desktop layout. The
 *  canvas is mouse-driven, so phone mounts `MobileTileView` and compact mounts
 *  `CompactTileView` instead, and the canvas isn't present to target. */
export const supportsSpatialCanvas = () => isDesktop();

/** Whether the workspace switcher (the palette's "Search workspaces" group) is
 *  offered. Touch layouts navigate terminals through their dock instead. */
export const showsWorkspaceSwitcher = () => isDesktop();

/** Ambient and contextual tips render only where there is room for the banner —
 *  suppressed on the compact touch layouts. */
export const showsAmbientTips = () => isDesktop();

/** The bird's-eye welcome — the three "moments" and the install card — renders
 *  only on the desktop layout. Touch layouts have no welcome, by design. */
export const showsWelcome = () => isDesktop();
