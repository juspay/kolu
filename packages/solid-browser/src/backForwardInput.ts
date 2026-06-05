/** The mouse's dedicated back/forward (X1/X2) buttons, decoded once.
 *
 *  Pure and framework-free — no solid-js, no DOM library — so the in-iframe
 *  artifact-sdk can import this single module without pulling the Solid barrel
 *  into its sandboxed bundle. The "`button` 3 means back, 4 means forward" fact
 *  and the swallow-on-down / act-on-up / preventDefault-on-both protocol live
 *  here exactly once; every input site (Code tab, docsite, iframe) plugs its own
 *  onBack/onForward into the shared decode rather than re-deriving the button
 *  numbers and the down/up dance. */

/** Decode a mouse event's button into a navigation direction. The dedicated
 *  back/forward buttons surface as `button` 3 (back) and 4 (forward); anything
 *  else returns null. */
export function mouseButtonDirection(e: MouseEvent): "back" | "forward" | null {
  if (e.button === 3) return "back";
  if (e.button === 4) return "forward";
  return null;
}

/** Bind the X1/X2 back/forward buttons on `target`, invoking `onBack` /
 *  `onForward` when the user releases the matching button. Swallows the buttons
 *  on the way down so the host doesn't start its own native navigation, acts on
 *  the way up, and `preventDefault`s both down and up so only the supplied
 *  callbacks navigate. Returns a disposer that removes both listeners. */
export function attachBackForwardMouse(
  target: EventTarget,
  handlers: { onBack: () => void; onForward: () => void },
): () => void {
  // Swallow the buttons on the way down so the host doesn't begin its own
  // back/forward; act on the way up.
  const onDown = (e: Event) => {
    if (mouseButtonDirection(e as MouseEvent) !== null) e.preventDefault();
  };
  const onUp = (e: Event) => {
    const direction = mouseButtonDirection(e as MouseEvent);
    if (direction === null) return;
    e.preventDefault();
    if (direction === "back") handlers.onBack();
    else handlers.onForward();
  };
  target.addEventListener("mousedown", onDown);
  target.addEventListener("mouseup", onUp);
  return () => {
    target.removeEventListener("mousedown", onDown);
    target.removeEventListener("mouseup", onUp);
  };
}
