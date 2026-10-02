/**
 * The SUPERSESSION FENCE — "a call bound to a wire that has since moved on must
 * FAIL, not park."
 *
 * ## The fact
 *
 * Effect RPC registers a call once and does not replay it onto another link.
 * When followingWire adopts a new generation, calls bound to the old link
 * must fail with RpcClientError so the face's retry fence can re-subscribe.
 * followingWire is this module's only consumer. Websocket reconnect failures
 * are broadcast by Effect itself; they do not use this fence.
 *
 * This module owns the ordering law:
 *
 *   **advance the mark → notify the consumer → sweep the superseded calls.**
 *
 * The order is load-bearing in both directions. The mark moves FIRST so a
 * consumer that issues a call from inside `notify` has already bound to the new
 * mark and cannot be failed by its own arrival. The sweep runs LAST so those
 * consumers are already re-armed when the old calls die. {@link
 * Supersession.advance} takes the notify as an ARGUMENT for exactly that reason:
 * the three steps are one call, in one order, and the sweep runs in a `finally`
 * so a throwing consumer callback cannot leave calls bound below the mark with
 * nothing left to fail them.
 *
 * Package-internal: not exported through any `@kolu/surface/*` subpath. It is
 * the following wire’s generation fence, not a public contract.
 */

import { Effect, Stream } from "effect";
import {
  RpcClientDefect,
  type RpcClientError,
  RpcClientError as RpcClientErrorClass,
} from "effect/rpc/RpcClientError";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";

/** A monotonic MARK plus the fence that reads it. */
export interface Supersession {
  /** Advance past the current mark, run `notify`, then fail every call bound at
   *  or below the old mark — in that order, and with the sweep in a `finally` so
   *  a throwing `notify` cannot skip it. See the module docstring for why the
   *  order is the whole point. */
  readonly advance: (notify: () => void) => void;
  /** The branded dispatch that enforces the fence.
   *
   *  `inner` is read PER CALL (so a dispatch that moves with the mark — a
   *  following wire's generation — is fine). Each call binds to the current
   *  mark. Both legs are `suspend`ed, so the reads happen when
   *  the call RUNS, never when its lazy value was built.
   *
   *  Streams use `interruptWhen`, not `haltWhen`: a superseded subscription is
   *  parked ON a pull that will never complete, and `haltWhen` waits for the
   *  current pull. The guard's FAILURE becomes the stream's failure, which is
   *  what the fence retries on. It cannot fire synchronously with the subscribe
   *  (the mark is read in the same tick it is compared against), so
   *  `SurfaceDispatch`'s no-synchronous-end invariant still holds. */
  readonly wrap: (inner: () => SurfaceDispatch) => SurfaceDispatch;
}

export function supersession(): Supersession {
  let mark = 0;
  const watchers = new Set<(mark: number) => void>();

  /** Explain why this generation's calls must fail instead of remaining pending. */
  const message = (bound: number, now: number): string =>
    `the wire adopted a new generation beneath this call: it was bound to generation ${bound}, the wire is now at generation ${now}. ` +
    `Effect RPC registers an entry exactly once and never re-sends it onto another link, and an answer can ` +
    `only travel the link its request went out on — so this call could only park forever. Failing it is the ` +
    `honest signal: the per-subscription retry fence re-subscribes on the new link.`;

  /** `RpcClientError` is not decoration: the per-subscription fence matches
   *  transport failures STRUCTURALLY on `_tag === "RpcClientError"`
   *  (`../client.ts`'s `isTransportError`), and this IS a transport failure — the
   *  transport that was carrying the call is gone. */
  const superseded = (bound: number, now: number): RpcClientError =>
    new RpcClientErrorClass({
      reason: new RpcClientDefect({
        message: message(bound, now),
        cause: new Error(
          `followingWire: generation ${now} superseded generation ${bound}`,
        ),
      }),
    });

  /** Never succeeds; fails the moment the mark passes `bound`.
   *
   *  The registration is asynchronous relative to the current-mark read at the
   *  call site, so an advance can complete in between — hence the eager re-check
   *  rather than an assumption. */
  const guard = (bound: number): Effect.Effect<never, RpcClientError> =>
    Effect.callback<never, RpcClientError>((resume) => {
      if (mark > bound) {
        resume(Effect.fail(superseded(bound, mark)));
        return;
      }
      const watcher = (next: number): void => {
        if (next <= bound) return;
        watchers.delete(watcher);
        resume(Effect.fail(superseded(bound, next)));
      };
      watchers.add(watcher);
      return Effect.sync(() => {
        watchers.delete(watcher);
      });
    });

  return {
    advance: (notify) => {
      mark += 1;
      try {
        notify();
      } finally {
        // A COPY, so a watcher that unregisters itself (or a sibling) mid-sweep
        // cannot perturb the walk.
        for (const watcher of [...watchers]) watcher(mark);
      }
    },
    // Re-branded: `brandHalfOpenDispatch` is by IDENTITY and this is a new
    // object. A wire dispatch that lost the brand would be accepted by
    // `surfaceClient` with no watchdog — the green-dot-over-a-dead-link lie
    // (#1564).
    wrap: (inner) =>
      brandHalfOpenDispatch({
        unary: (tag: string, payload: unknown) =>
          Effect.suspend(() =>
            Effect.raceFirst(inner().unary(tag, payload), guard(mark)),
          ),
        stream: (tag: string, payload: unknown) =>
          Stream.suspend(() =>
            Stream.interruptWhen(inner().stream(tag, payload), guard(mark)),
          ),
      }),
  };
}
