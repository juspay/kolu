/** Force evaluation of a lazily-wrapped JSX tree — in a Node test nothing
 *  inserts the element into a DOM, so unwrap accessors by hand. Shared by the
 *  `/solid` tests that mount a (possibly throwing) tree without a renderer. */
export const resolveTree = (el: unknown): unknown => {
  let v = el;
  while (typeof v === "function") v = (v as () => unknown)();
  return v;
};
