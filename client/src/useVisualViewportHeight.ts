/** Reactive `window.visualViewport.height` — the real available height
 *  after the mobile soft keyboard opens.
 *
 *  The CSS `dvh` unit does NOT shrink for the virtual keyboard: the spec
 *  scopes `dvh` to URL-bar chrome only, so `h-dvh` on the app root leaves
 *  most of the screen occluded by the keyboard on Samsung Chrome in
 *  landscape (and on iOS Safari, which additionally ignores the
 *  `interactive-widget=resizes-content` meta hint entirely).
 *
 *  App.tsx binds the root's height to this signal so the layout tracks
 *  the keyboard cleanly; every descendant that measures available space
 *  (xterm grid fit, TerminalPane resizable, TerminalPreview scale math)
 *  picks up the new dimensions via DOM reflow with no extra wiring. */

import { type Accessor, createSignal, onMount } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";

export function useVisualViewportHeight(): Accessor<number> {
  // Synchronous fallback for the first frame before onMount runs —
  // window.innerHeight is always defined and gives a reasonable bootstrap
  // so the consumer never has to handle an undefined height.
  const [h, setH] = createSignal(window.innerHeight);
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return; // pre-2018 browser — stay with innerHeight
    // Attach the listener BEFORE the initial read so any resize that
    // fires during the mount window (PWA launched with keyboard already
    // present, cold load mid-rotation) is still captured.
    const update = () => setH(vv.height);
    makeEventListener(vv, "resize", update);
    update();
  });
  return h;
}
