/** The browser's own page magnification, refused once — the single home for
 *  this rule and for why kolu wants it.
 *
 *  A trackpad pinch reaches a page as a `wheel` event carrying `ctrlKey: true`,
 *  the same shape as Ctrl+mouse-wheel, which no browser can tell it apart from.
 *  Left alone either one magnifies the whole document
 *  (`visualViewport.scale > 1`), and an app sized to its window never wants
 *  that: the layout keeps the window's width, so magnifying it only pushes the
 *  right-hand side and the bottom off screen (#2354).
 *
 *  Pure and framework-free — no solid-js, no DOM library — like its sibling
 *  `./backForwardInput`, because the rule has a consumer on each side of a
 *  sandbox: kolu's own window, and the in-iframe artifact-sdk bundle. A
 *  sandboxed frame's wheel events are dispatched to ITS document and never
 *  reach the parent window, so the frame must refuse magnification itself —
 *  with the same rule, not a second copy of it. */

/** Refuse page magnification on `target`. Listens in the CAPTURE phase and
 *  `preventDefault`s every `ctrlKey` wheel it sees, so no descendant can reopen
 *  the hole by calling `stopPropagation()` without a `preventDefault()` of its
 *  own. Non-passive, which `preventDefault` on a window-level wheel listener
 *  requires.
 *
 *  A surface that wants the gesture for itself (kolu's canvas zooms on pinch)
 *  claims it with its own listener and its own `preventDefault`; this guard
 *  neither knows nor cares, because "the page must not magnify" holds either
 *  way. Keyboard zoom (Ctrl +/−/0) is untouched — it is not a wheel event.
 *
 *  Scope is the `wheel` gesture of desktop Chrome/Firefox, deliberately: Safari
 *  reports a pinch as `gesturestart`/`gesturechange` and a touch device pinches
 *  through `touch-action`, and neither is handled here.
 *
 *  Returns a disposer that removes the listener. */
export function attachPageZoomGuard(target: Window): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  const options = { capture: true, passive: false };
  target.addEventListener("wheel", onWheel, options);
  return () => target.removeEventListener("wheel", onWheel, options);
}
