/** Resolved view capabilities — named answers to "what feature does this surface
 *  offer?", each computed once from the raw viewport signal in `useMobile`.
 *  Feature-availability code asks a capability here instead of re-deriving it
 *  from `isMobile()` at every call site, so when the form-factor rule for a
 *  capability changes it changes here, not across every consumer. All three
 *  currently key off viewport size (`isMobile`) — the canvas isn't mounted on the
 *  mobile layout, and tips/switcher follow the same compact-layout decision — but
 *  each is a distinct capability that can change axis independently.
 *
 *  NOT every form-factor read belongs here — only boolean *feature-availability*
 *  gates do. These raw reads are deliberate and stay raw:
 *   - `App.tsx`'s `match(isMobile())` macro layout fork — the receptacle that
 *     mounts the mobile vs. desktop subtree.
 *   - Layout-specific workarounds keyed on the mobile drawer layout, e.g.
 *     `CodeTab`'s portaled-tree touch-scroll driver (`isMobile`).
 *   - Diagnostic display of the signal's current value (`DiagnosticInfo`).
 *   - Input-modality behavior keyed on `isTouch` (a separate axis): soft-keyboard
 *     dismissal, tap-target density, the soft-keyboard input surface. */

import { isMobile } from "./useMobile";

/** The spatial pan/zoom canvas — and the tile commands that act on it
 *  (center-on-active, arrange-by-repo) — exist only on the desktop layout. On
 *  mobile `App.tsx` mounts `MobileTileView` instead, so the canvas isn't present
 *  to target. */
export const supportsSpatialCanvas = () => !isMobile();

/** Whether the workspace switcher (the palette's "Search workspaces" group) is
 *  offered. Mobile navigates terminals through its dock drawer instead. */
export const showsWorkspaceSwitcher = () => !isMobile();

/** Ambient and contextual tips render only where there is room for the banner —
 *  suppressed on the compact mobile layout. */
export const showsAmbientTips = () => !isMobile();
