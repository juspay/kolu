import type { Subscription } from "@kolu/surface/solid";

/** Window an optional reactive owner (`select()`) into a floored `Subscription<T>`.
 *
 *  This is a pure `Subscription`-shape helper: it closes over nothing but its own
 *  arguments, so it depends on neither the wire nor the active scope. The
 *  removal-race floor rule therefore lives in ONE place and can't drift from
 *  `Subscription`'s shape or be re-stamped wrong at a new facade.
 *
 *  Consumers that "window the active host's RETAINED sub into a STABLE facade" —
 *  `savedSessionSub` / `terminalListSub` in `activeWire.ts`, and the Code-tab query
 *  facades in `hostCodeTab.ts` — are the same concept, differing only in which
 *  member they select and how they map its value: `select()` is briefly `undefined`
 *  during the removal race (the active host left the pool; `wire.ts`'s reconcile
 *  re-points `activeHost` a tick later), and every field floors that gap the same way
 *  — `pending` to `true` (nothing to report reads pre-first-value), `error` passes
 *  through, `complete` to `false`, and the value to `floor` (the caller's empty form)
 *  when the source is absent or yields nullish.
 *
 *  `complete` is FORWARDED, not dropped: subs minted by subscription factories always
 *  populate `complete` — omitting it would silently strand a consumer that checks it
 *  (there is none today, but the field-audit rule is "populate what the source has,"
 *  not "only what today's readers use").
 *
 *  GRADUATION OPPORTUNITY (recorded, not acted on): this is a domain-agnostic
 *  `Subscription`-shape utility — it hides the removal-race floor over ANY keyed owner,
 *  nothing kolu-specific. It reads like a candidate to graduate INTO `@kolu/surface-map`
 *  beside `scopedByEntry` (the receptacle whose `.active()` gap it floors). Left in the
 *  app for now, deliberately: prove-then-extract gates the MOVE, not the naming, and at
 *  population two (`activeWire`, `hostCodeTab`) the floor rule is still a bounded leaf, not
 *  yet a proven cross-package volatility. Extract when a third, out-of-app consumer appears. */
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
