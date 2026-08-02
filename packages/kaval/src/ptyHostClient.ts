/**
 * `PtyHostClient` — the one typed face for talking to a pty-host, and the one
 * way to build it over whatever dispatch you have.
 *
 * The surface framework splits a client into two layers (PLAN D2): a
 * transport-neutral, tag-keyed {@link SurfaceDispatch} that a LINK produces
 * (`unixSocketLink`, `stdioLink`, `directDispatch`), and a nested member FACE
 * built over it. This module pins the second layer for `ptyHostSurface`, so every
 * consumer — the in-process web path, kaval-tui's socket, kaval-tui's ssh stdio
 * front, padi's dial — holds the SAME type and reaches members the same way.
 *
 * It lives beside the contract rather than inside `inProcessPtyHost.ts` because
 * the face is transport-agnostic: the in-process serving is one caller of it, not
 * its home.
 */

import { buildSurfaceFace } from "@kolu/surface/client";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { SurfaceClientOf } from "@kolu/surface/project";
import { ptyHostSurface } from "./ptyHostSurface.ts";

/** The typed client for talking to a pty-host. In-process today
 *  (`createInProcessPtyHost`); the identical type backs a socket- or ssh-served
 *  daemon — so the consumer is invariant under that swap.
 *
 *  It is the framework's own spec-derived member face (`SurfaceClientOf`), not a
 *  hand-written mirror: `client.surface.<member>.<verb>` is typed straight off
 *  `ptyHostSurface.spec`, so a schema edit is a compile error at every call site
 *  rather than a runtime surprise. Two shape changes every consumer sees, both
 *  from the Effect port:
 *
 *    - a PROCEDURE still returns `Promise<Out>`, but its INPUT is the ENCODED
 *      side of the schema (D2/#13) — the face decodes at its edge, exactly where
 *      zod's `.parse`-at-input used to run;
 *    - a STREAM member returns a lazy `Stream<Out>` SYNCHRONOUSLY (was
 *      `Promise<AsyncIterable<Out>>` plus an `AbortSignal` call option).
 *      Cancellation is fiber interruption (D10/#18): there is no signal to thread
 *      and none to forget. A non-Effect consumer spells the unsubscribe as
 *      `iterator.return()` over `Stream.toAsyncIterable`.
 *
 *  `SurfaceReadFace` (its element type) declines to spell cell/collection
 *  MUTATION verbs, which costs this surface nothing: it declares neither. For
 *  `ptyHostSurface` the read face IS the whole face. */
export type PtyHostClient = SurfaceClientOf<typeof ptyHostSurface.spec>;

/** Build the pty-host face over any dispatch — a wire link's
 *  (`unixSocketLink(...).dispatch`, `stdioLink(...).dispatch`) or the in-process
 *  `directDispatch`.
 *
 *  ONE cast, here, so no consumer writes its own. `buildSurfaceFace` returns the
 *  deliberately STRUCTURAL `SurfaceFace` — per-member precision is spec-derived
 *  and lives one layer up, because a second precise mapped type in the same
 *  evaluation pass is the union-budget blowup D2 exists to avoid — and
 *  `SurfaceClientOf` is exactly that spec-derived projection OF THIS SAME WALK.
 *  The runtime object carries every member the type names, minted by
 *  `defineSurface`'s own tag algebra; the cast only tells the compiler which
 *  projection it is looking at. It is the same cast `surfaceClientRef` makes for
 *  the in-process leg. */
export function ptyHostClientOver(dispatch: SurfaceDispatch): PtyHostClient {
  return buildSurfaceFace(ptyHostSurface, dispatch) as unknown as PtyHostClient;
}
