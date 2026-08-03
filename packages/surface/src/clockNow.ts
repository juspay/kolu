/**
 * Framework-reserved wall-clock probe — the clock twin of the reserved liveness
 * (`./liveness`) and identity (`./identity`) members.
 *
 * Every surface built by `defineSurface` carries one reserved procedure,
 * `surface/system/clockNow`, that `implementSurface` auto-answers with the serving
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

import { Effect, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

/** The namespace + verb of the reserved clock procedure, single-sourced so the
 *  tag minting (`defineSurface`), the server auto-answer (`implementSurface`),
 *  and the client probe never drift. Shares the `system` namespace with `live` /
 *  `identity`. */
export const CLOCK_NOW_NAMESPACE = "system";
export const CLOCK_NOW_VERB = "clockNow";

/** What the server SERVES over `system/clockNow`: its own wall-clock reading. */
export const ServedClockNowSchema = Schema.Struct({ epochMs: Schema.Number });
export type ServedClockNow = typeof ServedClockNowSchema.Type;

/** The reserved clock procedure's payload schema — empty in, encoded as `{}`
 *  exactly as the `oc.input(z.object({}))` shape it replaces. */
export const ClockNowPayloadSchema = Schema.Struct({});

/** The reserved clock `Rpc`, minted at `tag` — empty in, {@link ServedClockNow}
 *  out. Both the runtime emitter and the type oracle {@link ReservedClockNowRpc}
 *  reads (see `./liveness` for why reserved members need no separate oracle). */
export function buildClockNowRpc<Tag extends string>(tag: Tag) {
  return Rpc.make(tag, {
    payload: ClockNowPayloadSchema,
    success: ServedClockNowSchema,
  });
}

/** The reserved clock procedure's `Rpc` type under a surface's tag prefix. Unioned
 *  into every `SurfaceRpcsFor<S>` (beside the liveness / identity reserved Rpcs). */
export type ReservedClockNowRpc<Prefix extends string> = ReturnType<
  typeof buildClockNowRpc<`${Prefix}${typeof CLOCK_NOW_NAMESPACE}/${typeof CLOCK_NOW_VERB}`>
>;

/** A client (or its `.rpc`) that can be probed for its wall clock — anything exposing
 *  the reserved `surface.system.clockNow` round-trip. `probeSurfaceClockNow` casts once
 *  internally so a session/mirror passes `client` with no boundary cast.
 *
 *  There is no `options` bag and no signal: the member call is a lazy `Effect`, so a
 *  caller that gives up (a deadline, a superseded dial, a destroyed session) cancels
 *  the in-flight request by interrupting the fiber it ran the probe on (D10/#18). */
export type SurfaceClockNowProbeable = {
  surface: Record<
    typeof CLOCK_NOW_NAMESPACE,
    Record<
      typeof CLOCK_NOW_VERB,
      (input: Record<string, never>) => Effect.Effect<ServedClockNow, unknown>
    >
  >;
};

/** The route is STRUCTURALLY absent on the probed client — its surface predates the
 *  reserved member (an OLDER server than this framework, e.g. a rolling upgrade dialling a
 *  padi that has no `system/clockNow`) or the whole `system` namespace is missing. A TYPED
 *  signal so a caller classifies "member absent" by an `instanceof` check, NEVER by
 *  string-matching a `TypeError` message (which differs by WHICH navigation step is
 *  undefined and by JS engine — the fragile heuristic this replaces). Distinct from the
 *  far END refusing the call (the tag exists on this client but the server has no handler
 *  for it, which surfaces as a transport-level `RpcClientError`); both are
 *  permanent-absent, and `makeSession` treats them alike.
 *
 *  Deliberately NOT one of the D4 tagged errors (`./errors`): it never crosses a wire.
 *  It is raised LOCALLY, by this process, about the shape of the client object in its
 *  own hand — so it has no schema and no `_tag` to preserve across a hop. */
export class ClockNowUnavailableError extends Error {
  constructor(reason: string) {
    super(`reserved system.clockNow is unavailable on this client (${reason})`);
    this.name = "ClockNowUnavailableError";
  }
}

/** The framework-reserved clock round-trip — the clock twin of
 *  `probeSurfaceIdentity` / `probeSurfaceLive`. Succeeds with the server's
 *  own wall clock ({@link ServedClockNow}). Pass the thing that carries `.surface`; a
 *  caller that gives up on the probe cancels the in-flight request by interrupting the
 *  fiber, so there is no signal to thread — see `makeSession`'s clock poll.
 *
 *  Navigates the route defensively and FAILS with a TYPED
 *  {@link ClockNowUnavailableError} when it is structurally absent, so the caller never
 *  has to infer "member absent" from a `TypeError` message substring. The check is
 *  inside the effect (`Effect.suspend`), so an absent member is a failure on the
 *  channel the caller is already handling rather than a throw at the moment the probe
 *  was merely BUILT. */
export function probeSurfaceClockNow(
  client: unknown,
): Effect.Effect<ServedClockNow, unknown> {
  return Effect.suspend(() => {
    const surface = (client as Partial<SurfaceClockNowProbeable>).surface;
    const verb = surface?.[CLOCK_NOW_NAMESPACE]?.[CLOCK_NOW_VERB];
    if (typeof verb !== "function") {
      return Effect.fail(
        new ClockNowUnavailableError(
          surface === undefined
            ? "no `surface` on the client"
            : surface[CLOCK_NOW_NAMESPACE] === undefined
              ? "no reserved `system` namespace"
              : "no `system.clockNow` verb",
        ),
      );
    }
    return verb({});
  });
}

/** Measure the far-end host's wall-clock offset (ms) vs THIS process off one
 *  `system/clockNow` round-trip, RTT-compensated. Samples `sentMs` BEFORE the probe,
 *  computes `rtt` after it resolves, and returns
 *  `round(remoteEpochMs − (sentMs + rtt/2))` — the local sample is placed at the
 *  round-trip's MIDPOINT (the best single-probe estimate of when the server read its
 *  clock), so the offset is not biased by the one-way latency the way a post-await
 *  `Date.now()` would be. Same sign convention the old `measureClockOffset` used:
 *  `remoteMs − offset` maps a remote-clock timestamp to this process's local clock, so
 *  a keyed `SurfaceMap`'s `EntryClock.toLocal` needs no change. A LOCAL host (same wall
 *  clock) yields ~0 honestly; offset-at-hello IS the contract (re-measured on each
 *  admit, no continuous drift correction). */
export function measureSurfaceClockOffset(
  client: unknown,
): Effect.Effect<number, unknown> {
  return Effect.gen(function* () {
    const sentMs = Date.now();
    const { epochMs } = yield* probeSurfaceClockNow(client);
    const rtt = Date.now() - sentMs;
    return Math.round(epochMs - (sentMs + rtt / 2));
  });
}
