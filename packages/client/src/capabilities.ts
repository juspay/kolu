/** Resolved view capabilities — named answers to "what does this surface
 *  support?", each computed once from the raw viewport/input signals in
 *  `useMobile`. Feature code asks about a capability instead of re-deriving it
 *  from `isMobile()` at every call site, so when the form-factor rule for a
 *  capability changes it changes here, not across every consumer.
 *
 *  The macro layout fork in `App.tsx` (`match(isMobile())`) and the soft-keyboard
 *  receptacle (`withKeyboardDismiss`) stay where they are — those are the two
 *  places that legitimately resolve the raw signal. Everything that gates a
 *  *feature* on form factor routes through the verbs below.
 *
 *  All three currently key off viewport size (`isMobile`) — the canvas isn't
 *  mounted on the mobile layout, and tips/switcher follow the same compact-layout
 *  decision — but each is a distinct capability that can change axis independently
 *  without touching its consumers. */

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
