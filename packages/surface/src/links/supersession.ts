/**
 * The SUPERSESSION FENCE — "a call bound to a wire that has since moved on must
 * FAIL, not park."
 *
 * ## The fact
 *
 * Effect RPC registers a call's entry EXACTLY ONCE and never re-sends it, and an
 * answer can only travel the transport its request went out on. So a call is
 * bound to one transport by construction. When the thing underneath moves — a
 * websocket re-dial, or a {@link ./following} wire adopting a new generation —
 * every call that was in flight can only park forever over a wire that reports
 * itself healthy. That is the production incident behind kolu#2101: a woken tab
 * whose subscriptions were all parked while the socket, the watchdog and the
 * header dot were green.
 *
 * The answer is the same at both altitudes, and it is not a retry: FAIL those
 * calls, with an `RpcClientError`. That is the shape `../client.ts`'s
 * `isTransportError` recognises and `shouldRetryStreamError` retries on, so the
 * per-subscription retry fence re-subscribes and an UNFENCED caller gets a
 * rejected promise instead of a dead one. A link must never re-subscribe
 * internally (`./wire.ts` states that law) — failing honestly is how a link
 * hands the problem to the one layer that owns recovery.
 *
 * ## Why it is a module
 *
 * It was written twice, verbatim: `websocketLink`'s re-dial epoch and
 * `followingWire`'s generation counter were the same counter, the same watcher
 * set, the same eagerly-re-checked guard, the same error shape and the same
 * dispatch wrap, differing only in the word for "the thing that moved". Two
 * copies of an ordering law is one copy too many — and the law here is exactly
 * the kind that a later fix applies to one site and forgets at the other:
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
 * how two links keep one promise, not a promise of its own.
 */

import { Effect, Stream } from "effect";
import {
  RpcClientDefect,
  type RpcClientError,
  RpcClientError as RpcClientErrorClass,
} from "effect/unstable/rpc/RpcClientError";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";

/** The three NOUNS a superseded call's failure needs — because a re-dial and a
 *  generation change are different events and an operator reading a console must
 *  be able to tell them apart. Everything ELSE in that sentence is the law, and
 *  the law is this module's.
 *
 *  Taken as nouns rather than as a whole message on purpose. Typed as "give me
 *  the message", the four-sentence explanation of WHY a superseded call must fail
 *  got copied verbatim into both links — which is the very duplication this
 *  module exists to end, surviving the extraction one level up. A later fix to
 *  that explanation would have landed at one site and been forgotten at the
 *  other. */
export interface SupersessionWording {
  /** What MOVED, as a clause: "the wire re-dialled" / "the wire adopted a new
   *  generation". */
  readonly moved: string;
  /** What the mark is CALLED, singular: "socket epoch" / "generation". */
  readonly mark: string;
  /** What carries an answer: "socket" / "link". */
  readonly carrier: string;
  /** The one-line `cause` beneath the message, naming the link that moved. A
   *  function of the two marks, because the useful half of such a line is which
   *  mark the call was bound to and where the wire has got to. */
  readonly cause: (bound: number, now: number) => string;
}

/** A monotonic MARK plus the fence that reads it. */
export interface Supersession {
  /** The mark a call binds to when it STARTS. */
  readonly mark: () => number;
  /** Advance past the current mark, run `notify`, then fail every call bound at
   *  or below the old mark — in that order, and with the sweep in a `finally` so
   *  a throwing `notify` cannot skip it. See the module docstring for why the
   *  order is the whole point. */
  readonly advance: (notify: () => void) => void;
  /** The branded dispatch that enforces the fence.
   *
   *  `inner` is read PER CALL (so a dispatch that moves with the mark — a
   *  following wire's generation — is fine) and `bindingMark` decides which mark
   *  this call belongs to. Both legs are `suspend`ed, so the reads happen when
   *  the call RUNS, never when its lazy value was built.
   *
   *  Streams use `interruptWhen`, not `haltWhen`: a superseded subscription is
   *  parked ON a pull that will never complete, and `haltWhen` waits for the
   *  current pull. The guard's FAILURE becomes the stream's failure, which is
   *  what the fence retries on. It cannot fire synchronously with the subscribe
   *  (the mark is read in the same tick it is compared against), so
   *  `SurfaceDispatch`'s no-synchronous-end invariant still holds. */
  readonly wrap: (
    inner: () => SurfaceDispatch,
    bindingMark: () => number,
  ) => SurfaceDispatch;
}

export function supersession(wording: SupersessionWording): Supersession {
  let mark = 0;
  const watchers = new Set<(mark: number) => void>();

  /** THE SENTENCE, written once. It is what a consumer sees in a console when an
   *  UNFENCED call finally fails instead of hanging — what happened, why the call
   *  could only park, and what happens next — and every word of it but the three
   *  nouns is the law this module states. */
  const message = (bound: number, now: number): string =>
    `${wording.moved} beneath this call: it was bound to ${wording.mark} ${bound}, the wire is now at ${wording.mark} ${now}. ` +
    `Effect RPC registers an entry exactly once and never re-sends it onto another ${wording.carrier}, and an answer can ` +
    `only travel the ${wording.carrier} its request went out on — so this call could only park forever. Failing it is the ` +
    `honest signal: the per-subscription retry fence re-subscribes on the new ${wording.carrier}.`;

  /** `RpcClientError` is not decoration: the per-subscription fence matches
   *  transport failures STRUCTURALLY on `_tag === "RpcClientError"`
   *  (`../client.ts`'s `isTransportError`), and this IS a transport failure — the
   *  transport that was carrying the call is gone. */
  const superseded = (bound: number, now: number): RpcClientError =>
    new RpcClientErrorClass({
      reason: new RpcClientDefect({
        message: message(bound, now),
        cause: new Error(wording.cause(bound, now)),
      }),
    });

  /** Never succeeds; fails the moment the mark passes `bound`.
   *
   *  The registration is asynchronous relative to the `bindingMark()` read at the
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
    mark: () => mark,
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
    wrap: (inner, bindingMark) =>
      brandHalfOpenDispatch({
        unary: (tag: string, payload: unknown) =>
          Effect.suspend(() =>
            Effect.raceFirst(inner().unary(tag, payload), guard(bindingMark())),
          ),
        stream: (tag: string, payload: unknown) =>
          Stream.suspend(() =>
            Stream.interruptWhen(
              inner().stream(tag, payload),
              guard(bindingMark()),
            ),
          ),
      }),
  };
}
