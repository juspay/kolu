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
