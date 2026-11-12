/** The browser's own page magnification, refused once.
 *
 *  A trackpad pinch is delivered to a page as a `wheel` event carrying
 *  `ctrlKey: true` — the same shape as Ctrl+mouse-wheel, which the browser
 *  cannot distinguish from it. Left alone, either one magnifies the whole
 *  document (`visualViewport.scale > 1`), which is never what an app sized to
 *  the window wants: the layout keeps the window's width, so magnifying it just
 *  pushes the right-hand side and the bottom off screen.
 *
 *  Pure and framework-free — no solid-js, no DOM library — so the in-iframe
 *  artifact-sdk can import this single module into its sandboxed bundle, the
 *  way it already imports `./backForwardInput`. That matters more here than
 *  elsewhere: a sandboxed frame's wheel events never reach the parent window,
 *  so the frame has to refuse magnification itself, with the same rule. One
 *  module, both sides of the sandbox. */

/** Refuse page magnification on `target` (a `Window`). Listens in the CAPTURE
 *  phase and `preventDefault`s every `ctrlKey` wheel it sees, so no descendant
 *  can reopen the hole by calling `stopPropagation()` without a
 *  `preventDefault()` of its own. Non-passive, which is required for
 *  `preventDefault` on a wheel listener attached to a window.
 *
 *  A surface that wants the gesture for itself (a canvas zooming on pinch)
 *  claims it with its own listener and its own `preventDefault`; this guard
 *  neither knows nor cares, because "the page must not magnify" is true either
 *  way. Keyboard zoom (Ctrl +/−/0) is untouched — it is not a wheel event.
 *
 *  Returns a disposer that removes the listener. */
export function attachPageZoomGuard(target: EventTarget): () => void {
  const onWheel = (e: Event) => {
    if ((e as WheelEvent).ctrlKey) e.preventDefault();
  };
  const options = { capture: true, passive: false };
  target.addEventListener("wheel", onWheel, options);
  return () => target.removeEventListener("wheel", onWheel, options);
}
