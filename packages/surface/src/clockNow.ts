/**
 * Framework-reserved wall-clock probe — the clock twin of the reserved liveness
 * (`./liveness`) and identity (`./identity`) members.
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface.system.clockNow`, that `implementSurface` auto-answers with the serving
 * process's own wall clock (`{ epochMs: Date.now() }`). No app declares it, no app
 * implements it. Its sole purpose is to make "what time is it on your clock" a
 * UNIVERSAL question every serving process answers, so a consumer that binds a
 * remote surface can measure the clock OFFSET between the two hosts once at admit —
 * the offset a keyed `SurfaceMap` folds into `EntryStatus.connected` so two hosts
 * render on two clocks WITHOUT the consumer ever subtracting a foreign epoch.
 *
 * It sits in the SAME reserved `system` namespace as `live` and `identity`, so
 * reserving `clockNow` beside them can never clobber an app's `system.*`:
 * `defineSurface`'s `claim` merges the namespace and rejects only a duplicate VERB.
 * This generalizes what the PADI-specific `control.core.clockNow` procedure did
 * (measured via `@kolu/surface-remote`'s `measureClockOffset`) into one framework
 * member every server answers.
 */

import { oc } from "@orpc/contract";
import { z } from "zod";

/** The namespace + verb of the reserved clock procedure, single-sourced so the
 *  contract injection (`defineSurface`), the server auto-answer (`implementSurface`),
 *  and the client probe never drift. Shares the `system` namespace with `live` /
 *  `identity`. */
export const CLOCK_NOW_NAMESPACE = "system";
export const CLOCK_NOW_VERB = "clockNow";

/** What the server SERVES over `system.clockNow`: its own wall-clock reading. */
export const ServedClockNowSchema = z.object({ epochMs: z.number() });
export type ServedClockNow = z.infer<typeof ServedClockNowSchema>;

/** The reserved clock procedure's contract descriptor — empty in,
 *  {@link ServedClockNow} out. */
export const clockNowContractEntry = () =>
  oc.input(z.object({})).output(ServedClockNowSchema);

/** The reserved clock procedure as it appears under a surface contract's `surface`
 *  namespace: `{ system: { clockNow } }`. Intersected into every
 *  `SurfaceContractFor<S>` (beside `ReservedLivenessContract` /
 *  `ReservedIdentityContract`). */
export type ReservedClockNowContract = Record<
  typeof CLOCK_NOW_NAMESPACE,
  Record<typeof CLOCK_NOW_VERB, ReturnType<typeof clockNowContractEntry>>
>;

/** A client (or its `.rpc`) that can be probed for its wall clock — anything exposing
 *  the reserved `surface.system.clockNow` round-trip. `probeSurfaceClockNow` casts once
 *  internally so a session/mirror passes `client` with no boundary cast. */
export type SurfaceClockNowProbeable = {
  surface: Record<
    typeof CLOCK_NOW_NAMESPACE,
    Record<
      typeof CLOCK_NOW_VERB,
      (
        input: Record<string, never>,
        options?: { signal?: AbortSignal },
      ) => Promise<ServedClockNow>
    >
  >;
};

/** The framework-reserved clock round-trip — the clock twin of
 *  {@link probeSurfaceIdentity} / {@link probeSurfaceLive}. Resolves with the server's
 *  own wall clock ({@link ServedClockNow}). Pass the thing that carries `.surface`; an
 *  optional {@link AbortSignal} is forwarded to the oRPC call so a caller that gives up
 *  on the probe (a deadline, a superseded dial, a destroyed session) CANCELS the
 *  in-flight request rather than leaving it pending — see `makeSession`'s clock poll. */
export function probeSurfaceClockNow(
  client: unknown,
  signal?: AbortSignal,
): Promise<ServedClockNow> {
  return (client as SurfaceClockNowProbeable).surface[CLOCK_NOW_NAMESPACE][
    CLOCK_NOW_VERB
  ]({}, { signal });
}

/** Measure the far-end host's wall-clock offset (ms) vs THIS process off one
 *  `system.clockNow` round-trip, RTT-compensated. Samples `sentMs` BEFORE the probe,
 *  computes `rtt` after it resolves, and returns
 *  `round(remoteEpochMs − (sentMs + rtt/2))` — the local sample is placed at the
 *  round-trip's MIDPOINT (the best single-probe estimate of when the server read its
 *  clock), so the offset is not biased by the one-way latency the way a post-await
 *  `Date.now()` would be. Same sign convention the old `measureClockOffset` used:
 *  `remoteMs − offset` maps a remote-clock timestamp to this process's local clock, so
 *  a keyed `SurfaceMap`'s `EntryClock.toLocal` needs no change. A LOCAL host (same wall
 *  clock) yields ~0 honestly; offset-at-hello IS the contract (re-measured on each
 *  admit, no continuous drift correction). */
export async function measureSurfaceClockOffset(
  client: unknown,
  signal?: AbortSignal,
): Promise<number> {
  const sentMs = Date.now();
  const { epochMs } = await probeSurfaceClockNow(client, signal);
  const rtt = Date.now() - sentMs;
  return Math.round(epochMs - (sentMs + rtt / 2));
}
