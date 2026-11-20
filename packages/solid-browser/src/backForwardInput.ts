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
