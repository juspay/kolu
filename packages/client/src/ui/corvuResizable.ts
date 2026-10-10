import { type Accessor, createComputed, createSignal } from "solid-js";

/** Decode a Corvu Resizable `onSizesChange(sizes: number[])` emission down to
 *  the real, user-intended two-panel split.
 *
 *  Corvu's callback is leaky: besides legitimate user-drag fractions it also
 *  emits degenerate shapes the consumer never wants to persist — a LENGTH-1
 *  renormalized array on `unregisterPanel`/unmount, and `createEffect`-driven
 *  re-emissions of the current value. The one piece of application-agnostic
 *  lore — "a real layout has both panels" — lives here, once, instead of being
 *  re-derived (in three incompatible forms) at each call site. Per-domain
 *  clamps (min-size bands, collapse-from-zero epsilon) stay with the setters
 *  that own those concerns. */
export function realSizes(sizes: number[]): [number, number] | undefined {
  return sizes.length === 2 ? (sizes as [number, number]) : undefined;
}

/** The value to hand a controlled Corvu Resizable as `sizes`.
 *
 *  Corvu's `Resizable.Panel` unregisters itself in `onCleanup`, and in
 *  controlled mode that cleanup reads the `sizes` prop. Read inline, the prop
 *  re-runs the caller's derivation there — and a teardown happens inside the
 *  very flush that changed its inputs (a host switch, a canvas-mode change), so
 *  the derivation can hit a memo still pending in that flush. Solid answers a
 *  pending read by flushing upstream synchronously, which re-runs owners that
 *  are mid-disposal: an owner is cleaned twice and `cleanNode` throws, aborting
 *  the whole update. So Corvu reads a plain signal instead: one
 *  `createComputed` keeps it current in the update phase, and a teardown-time
 *  read has no sources left to recompute. */
export function controlledSizes(derive: () => number[]): Accessor<number[]> {
  const [sizes, setSizes] = createSignal<number[]>([], {
    equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  createComputed(() => setSizes(derive()));
  return sizes;
}
