/** Walk a host element + every nested shadow root reachable from it,
 *  invoking `visit` on each `ShadowRoot`. Stops and returns the first
 *  non-undefined value the visitor produces; returns `undefined` if no
 *  visit matched.
 *
 *  Pierre's `CodeView` renders each item into a `<diffs-container>` custom
 *  element whose `attachShadow({mode: "open"})` holds the user-visible
 *  text. Selection capture, shadow-aware `Selection` lookup, and the
 *  highlight overlay's root resolution all need to descend through
 *  potentially multiple per-item shadow roots — three separate sites used
 *  to roll their own walk. */

export function walkShadowRoots<T>(
  host: Element,
  visit: (root: ShadowRoot) => T | undefined,
): T | undefined {
  const stack: Element[] = [host];
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) continue;
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) {
      const out = visit(sr);
      if (out !== undefined) return out;
      for (const child of Array.from(sr.children)) stack.push(child);
    }
    for (const child of Array.from(el.children)) stack.push(child);
  }
  return undefined;
}
