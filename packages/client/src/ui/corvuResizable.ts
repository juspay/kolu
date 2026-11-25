import { type Accessor, createMemo } from "solid-js";

/** How a Corvu handle looks, by its root's `orientation`: a zero-size line
 *  whose `::before` is an 8px hit area, lit on hover. `vertical` stacks the
 *  panels, so its handle is a line across, dragged up and down; `horizontal`
 *  stands them side by side, so its handle is a line down, dragged left and
 *  right. A caller adds its own `z-index` for the stacking it sits in. */
export const RESIZE_HANDLE_CLASS = {
  vertical:
    "shrink-0 h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors",
  horizontal:
    "shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors",
} as const;

/** The two shares of a two-panel Resizable, from an `onSizesChange` report —
 *  or `undefined` while only one of its panels is mounted. Corvu reports a
 *  real layout each time one changes, and with one panel mounted that layout
 *  is `[1]`: there is no split in it to save. Per-domain clamps (min-size
 *  bands, collapse-from-zero epsilon) stay with the setters that own them. */
export function twoPanelSplit(
  sizes: readonly number[],
): [number, number] | undefined {
  const [first, second] = sizes;
  return sizes.length === 2 && first !== undefined && second !== undefined
    ? [first, second]
    : undefined;
}

/** The value to hand a controlled Corvu Resizable as `sizes`.
 *
 *  A memo, and read during TEARDOWN as well as render. The Corvu site
 *  (`@corvu-next/resizable`, `@corvu-next/utils`): `Resizable.Panel`'s
 *  `onCleanup` calls the root's `unregisterPanel`, which calls `setSizes(fn)`;
 *  `createControllableSignal`'s setter evaluates `fn(value())` inside
 *  `untrack`, and when controlled `value()` reads the `sizes` prop. A teardown
 *  happens inside the very flush that changed its inputs (a host switch, a
 *  canvas-mode change), so that read can land on a memo still dirty in the
 *  flush. Solid 2 answers it without re-entering disposal: `updateIfNecessary`
 *  refuses to recompute a node carrying the DISPOSED flag, `disposeChildren`
 *  returns at once on an already-disposed node, and `dispose` strips the
 *  observation lifecycle — so a dirty derivation read while its owner is being
 *  torn down recomputes pull-style, or answers with its last committed value
 *  if it is itself disposed.
 *
 *  What the memo earns over an inline `sizes={…}` is the value equality: on
 *  the controlled path the read IS this prop, and corvu's in-frame ledger
 *  (`@corvu-next/utils`, `createControllableSignal`) compares the owner's
 *  value with `Object.is` to decide whether the frame's staged write has
 *  landed — so a fresh array of the same two numbers each recompute would
 *  read as a change and defeat it. */
export function controlledSizes(derive: () => number[]): Accessor<number[]> {
  return createMemo(derive, {
    equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
}
