/**
 * Direct dispatch — the **identity element** of the link family.
 *
 * The wire links (`websocketLink`, `stdioLink`, `unixSocketLink`) *separate* the
 * serve side from the consume side: one process serves a group, another connects
 * over a transport. The direct dispatch *fuses* them — there is no wire, so serve
 * and consume collapse into one process. That's why it's shaped differently from
 * its siblings: instead of a transport (a socket, a stream pair), it takes the
 * **served handler record itself** (what `implementSurface` returns) and builds a
 * {@link SurfaceDispatch} straight over it. `client.cells.foo.use()` is then a
 * direct, microtask-deferred handler invocation — no serialization round-trip, in
 * either direction.
 *
 * That "no serialization" is now a fact of the TYPES, not a claim: S2 defined
 * every handler as a function of the member's DECODED payload returning an
 * `Effect` (unary) or a `Stream` (streaming), and {@link SurfaceDispatch}'s payload
 * side is the decoded side too. So the value the face decodes at its edge is the
 * value the handler receives — there is no encode/decode pair to skip, because
 * there never was one.
 *
 * This is what lets a project run the exact same consumer code against an
 * in-process implementation that it will later run against a socket/ssh-served
 * one: only the dispatch changes. A single-process deployment, a unit test, or the
 * in-process phase of a not-yet-decoupled service all hold the SAME face over the
 * same surface. (One honest difference: the direct dispatch carries no reconnect
 * behaviour — the face's retry fence still wraps it, but there is no transport to
 * drop, so it never fires.)
 *
 * Need the server-side mutation `ctx` too (to drive cells/collections from domain
 * code)? Destructure it from `implementSurface` alongside the handlers:
 * `const { handlers, ctx } = implementSurface(surface, deps)`.
 */

import { Effect, Stream } from "effect";
import { brandDirectDispatch, type SurfaceDispatch } from "../link";
import type { SurfaceHandlers } from "../server";

/** What {@link directDispatch} needs off a served surface — just the handler
 *  record. Accepts a whole `SurfaceRuntime` / `ServedSurface` structurally, so a
 *  call site writes `directDispatch(implementSurface(surface, deps))` without
 *  destructuring. */
export interface DirectlyDispatchable {
  readonly handlers: SurfaceHandlers;
}

/** Resolve one bound handler, or CRASH. A tag the served surface never bound is
 *  the in-process twin of a 404 — and unlike a wire 404 it can only mean the face
 *  and the runtime were built from DIFFERENT surfaces, which is a wiring bug, not
 *  a runtime condition. `implementSurface` already asserts route-set identity
 *  against its own group at boot (D1), so reaching here means the CALLER brought a
 *  foreign surface. Die loudly rather than resolve to `undefined` and fail with a
 *  "not a function" three frames later. */
function resolveHandler(handlers: SurfaceHandlers, tag: string) {
  const handler = handlers[tag];
  if (handler === undefined) {
    throw new Error(
      `directDispatch: no handler bound at "${tag}" — the served surface does ` +
        "not carry this member. The face and the runtime were built from " +
        "different surfaces (an in-process dispatch cannot 404 for any other " +
        "reason: `implementSurface` asserts its handler set equals its group's).",
    );
  }
  return handler;
}

/** Build the in-process dispatch over a served surface — the no-wire member of
 *  the link family.
 *
 *  ```ts
 *  const served = implementSurface(surface, deps);
 *  const client = surfaceClient(surface, directDispatch(served));
 *  ```
 *
 *  **Microtask-deferred, deliberately.** Both legs yield to the scheduler before
 *  touching a handler, so an in-process call is never *more* synchronous than the
 *  wire call it stands in for. Without it a consumer could observe a handler's
 *  first frame before its own `createSubscription` had finished wiring — an
 *  ordering that no socket-served deployment can reproduce, so a test that passed
 *  in-process would fail over the wire. The old `createRouterClient` gave this for
 *  free; here it is spelled out.
 *
 *  **`live` is constant-`true`, honestly.** There is no transport, so this
 *  dispatch cannot half-open — the one member of the family whose constant-`true`
 *  liveness leg is sound BY CONSTRUCTION rather than by assumption. That is what
 *  {@link brandDirectDispatch} records, and it is why `surfaceClient` accepts this
 *  dispatch bare while refusing a bare wire dispatch. */
export function directDispatch(served: DirectlyDispatchable): SurfaceDispatch {
  const { handlers } = served;
  return brandDirectDispatch<SurfaceDispatch>({
    unary: (tag, payload) =>
      Effect.flatMap(
        Effect.yieldNow,
        () => resolveHandler(handlers, tag)(payload) as Effect.Effect<unknown>,
      ),
    stream: (tag, payload) =>
      // `Stream.unwrap` over the deferred lookup: the yield happens at SUBSCRIBE
      // time (each retry attempt gets its own), not when the stream value is
      // built, so a stream held un-run costs nothing and a re-subscribe really
      // re-enters the handler.
      Stream.unwrap(
        Effect.map(
          Effect.yieldNow,
          () =>
            resolveHandler(handlers, tag)(payload) as Stream.Stream<unknown>,
        ),
      ),
  });
}
