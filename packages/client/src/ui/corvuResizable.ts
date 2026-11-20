import { type Accessor, createComputed, createSignal } from "solid-js";

/** Decode a Corvu Resizable `onSizesChange(sizes: number[])` emission down to
 *  the real, user-intended two-panel split: Corvu also emits a length-1
 *  renormalized array on `unregisterPanel`/unmount and re-emissions of the
 *  current value. */
export function realSizes(sizes: number[]): [number, number] | undefined {
  return sizes.length === 2 ? (sizes as [number, number]) : undefined;
}

/** The value to hand a controlled Corvu Resizable as `sizes`.
 *
 *  `@corvu/resizable` 0.2.5 reads the controlled `sizes` prop from
 *  `Resizable.Panel`'s `onCleanup`, so an inline derivation runs during
 *  teardown; a memo read there flushes upstream synchronously and re-runs
 *  owners mid-disposal (`cleanNode` throws). Hence a plain signal kept current
 *  by a `createComputed`. Retire when Corvu stops reading from that cleanup. */
export function controlledSizes(derive: () => number[]): Accessor<number[]> {
  const [sizes, setSizes] = createSignal<number[]>([], {
    equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
  createComputed(() => setSizes(derive()));
  return sizes;
}
