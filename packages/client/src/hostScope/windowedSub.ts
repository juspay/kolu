import type { Subscription } from "@kolu/surface/solid";

export function windowedSub<S, T>(
  select: () => Subscription<S> | undefined,
  map: (v: NonNullable<S>) => T,
  floor: T | undefined,
): Subscription<T> {
  return Object.assign(
    (): T | undefined => {
      const s = select();
      const v = s?.();
      return v == null ? floor : map(v as NonNullable<S>);
    },
    {
      pending: (): boolean => select()?.pending() ?? true,
      error: (): Error | undefined => select()?.error(),
      complete: (): boolean => select()?.complete?.() ?? false,
    },
  );
}
