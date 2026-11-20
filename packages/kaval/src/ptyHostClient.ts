import { buildSurfaceFace } from "@kolu/surface/client";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { SurfaceClientOf } from "@kolu/surface/project";
import { ptyHostSurface } from "./ptyHostSurface.ts";

/** The typed client for talking to a pty-host. In-process today
 *  (`createInProcessPtyHost`); the identical type backs a socket- or ssh-served
 *  daemon — so the consumer is invariant under that swap.
 *
 *  `client.surface.<member>.<verb>` is typed straight off
 *  `ptyHostSurface.spec`. Every member is Effect-native:
 *
 *    - a PROCEDURE returns a lazy `Effect<Out, E>` carrying the member's DECLARED
 *      error union (plus the framework's own `SurfaceCallFailure`), and takes the
 *      ENCODED side of its input schema — the face decodes at its edge. Nothing
 *      is dispatched until the effect is run;
 *    - a STREAM member returns a lazy `Stream<Out>` SYNCHRONOUSLY. Cancellation
 *      is fiber interruption: there is no signal to thread and none to forget. A
 *      non-Effect consumer spells the unsubscribe as `iterator.return()` over
 *      `Stream.toAsyncIterable`. */
export type PtyHostClient = SurfaceClientOf<typeof ptyHostSurface.spec>;

/** Build the pty-host face over any dispatch — a wire link's
 *  (`unixSocketLink(...).dispatch`, `stdioLink(...).dispatch`) or the in-process
 *  `directDispatch`. */
export function ptyHostClientOver(dispatch: SurfaceDispatch): PtyHostClient {
  return buildSurfaceFace(ptyHostSurface, dispatch) as unknown as PtyHostClient;
}
