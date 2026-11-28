/** A ref that hands something to the element, and an owner that takes it back.
 *
 *  THE RULE, once: a ref callback is not a scope a cleanup may be registered
 *  in (Solid 2 answers `CLEANUP_IN_FORBIDDEN_SCOPE`), so whatever the ref
 *  attached — a native listener, a slot in a map, an anchor a panel floats
 *  against — is released by the owner that ASKED for the ref: the component
 *  body, or the `<For>` item's own render owner. The element itself is the one
 *  thing the ref may write, so it is held here and the release is handed
 *  exactly the element the ref last recorded.
 *
 *  Call this where that owner is (in the render body, not inside another
 *  callback), and put the result on the element's `ref`. */

import { onCleanup } from "solid-js";

export function refWithRelease<E extends Element>(
  attach: (el: E) => void,
  release: (el: E) => void,
): (el: E) => void {
  let held: E | undefined;
  onCleanup(() => {
    if (held !== undefined) release(held);
  });
  return (el) => {
    held = el;
    attach(el);
  };
}
