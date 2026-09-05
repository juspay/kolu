/**
 * `followingWire` — ONE wire the consumer holds, over a SUCCESSION of underlying
 * wires.
 *
 * Every other link in this family owns a transport for its whole life: dispose it
 * and the dispatch it minted is a corpse. That is the honest shape when the thing
 * underneath is a socket the link itself re-dials — a reconnect is the SAME wire
 * carrying on, and `websocketLink` already hides it.
 *
 * It is NOT the honest shape when the thing underneath has to be REPLACED. Effect
 * RPC resolves a call's payload/success/error schemas by looking the tag up in the
 * `RpcGroup` its client was built over, and that group is fixed when the link is
 * opened (`openWireLink` does `RpcClient.make(group, …)` once). So a wire whose
 * SERVED MEMBERS change — a surface app whose sibling roster moves while the tab
 * stays open (juspay/kolu#2227, the client half of #2225) — needs a new link at
 * both ends. Without this module, that fact reaches all the way up: every client,
 * every standing subscription and every reactive handle built over the old
 * dispatch is dead, so the page rebuilds its whole tree to follow a roster move.
 *
 * This is where that fact stops. A following wire is a {@link WireTransport} whose
 * `dispatch` and `wire` are STABLE VALUES, and whose CURRENT GENERATION —
 * a real link, dialled over a real group — is replaced by {@link
 * FollowingWire.adopt}. Everything built over the stable halves (a
 * `createLiveSignal` watchdog, the clients it backs, their standing subscriptions)
 * survives a generation change; only the socket underneath is new.
 *
 * ## The three things `adopt` owes, and why each is not optional
 *
 *  1. **Calls issued after it go to the NEW generation.** Both dispatch legs are
 *     `suspend`ed, so the generation is read when a call RUNS, never when its
 *     lazy value was built.
 *  2. **Calls IN FLIGHT across it FAIL, and fail as a TRANSPORT error.** A call
 *     is bound to one link by construction — Effect RPC registers an entry
 *     exactly once and an answer can only travel the socket its request went out
 *     on — so a call that was in flight when the generation moved can only park
 *     forever. This is the same fact `websocketLink`'s re-dial epoch answers one
 *     layer down (kolu#2101 J1), for the same reason, in the same shape: the
 *     failure is an `RpcClientError`, which is precisely what the face's
 *     per-subscription retry fence (`../client.ts`'s `fenceStream`) retries on.
 *     So a standing subscription re-subscribes ITSELF onto the new generation —
 *     the framework's one recovery path, not a second one written here. A link
 *     that re-subscribed internally would hide the failure the fence must see,
 *     which is the law `./wire.ts` states for every link in this family.
 *  3. **The superseded generation is RELEASED.** `adopt` owns it, because the
 *     alternative is a caller that must remember to — and a link nobody closes
 *     keeps a socket, a ping fiber and a re-dial schedule alive for the life of
 *     the page. The release is AWAITED by `adopt`'s promise but happens AFTER the
 *     swap, so the handover itself is synchronous: there is no window in which
 *     the wire has no generation.
 *
 * ## What it is not
 *
 * Not a reconnect, and not a retry. A generation change is a deliberate act by
 * the consumer that dialled the replacement; a DROP is still the underlying
 * link's own business and is forwarded through `wire.onStatus` unchanged.
 */

import { Effect, Stream } from "effect";
import {
  RpcClientDefect,
  type RpcClientError,
  RpcClientError as RpcClientErrorClass,
} from "effect/unstable/rpc/RpcClientError";
import {
  brandHalfOpenDispatch,
  type SurfaceDispatch,
  type WireStatus,
  type WireTransport,
} from "../link";

/** One generation of a {@link FollowingWire}: the `{ dispatch, wire }` pairing a
 *  wire link factory minted, plus the release that closes it.
 *
 *  The two travel together because {@link FollowingWire.adopt} owns the
 *  superseded generation's teardown — see (3) in the module docstring. `T` is
 *  the caller's own link type (a `WebsocketLink`, say), preserved so
 *  {@link FollowingWire.current} can hand back facts that belong to a generation
 *  rather than to the standing wire. */
export interface WireGeneration<T extends WireTransport = WireTransport> {
  readonly transport: T;
  readonly dispose: () => Promise<void>;
}

/** A wire whose GENERATION can be replaced while everything built over it keeps
 *  standing. `dispatch` and `wire` are the stable halves; `current` is the
 *  moving one. */
export interface FollowingWire<T extends WireTransport = WireTransport>
  extends WireTransport {
  /** The generation's own link, for a fact that belongs to a generation and not
   *  to the standing wire — a websocket link's dial history and epoch, say.
   *  READ it at the moment you need such a fact; never HOLD it, because the next
   *  `adopt` replaces it. */
  readonly current: () => T;
  /** Take `next` as the generation every call from now on rides, fail whatever
   *  was in flight over the old one, and release it. Resolves once the
   *  superseded generation is closed; the SWAP itself is synchronous, so a
   *  caller can rely on the wire never being between generations.
   *
   *  Refuses on a disposed wire: adopting onto one would open a generation
   *  nothing will ever close. */
  adopt(next: WireGeneration<T>): Promise<void>;
  /** Release the generation currently held. Idempotent. */
  dispose(): Promise<void>;
}

/** The failure a call superseded by an `adopt` carries.
 *
 *  `RpcClientError` is not decoration: the per-subscription fence matches
 *  transport failures STRUCTURALLY on `_tag === "RpcClientError"`
 *  (`../client.ts`'s `isTransportError`), and this IS a transport failure — the
 *  transport that was carrying the call has been replaced. The message states the
 *  whole derivation, because it is what a consumer reads in a console when an
 *  UNFENCED call fails instead of hanging. */
function supersededError(bound: number, now: number): RpcClientError {
  return new RpcClientErrorClass({
    reason: new RpcClientDefect({
      message:
        `the wire adopted a new generation beneath this call: it was bound to generation ${bound}, the wire is now at generation ${now}. ` +
        "Effect RPC registers an entry exactly once and never re-sends it onto another link, and an answer can only travel the " +
        "link its request went out on — so this call could only park forever. Failing it is the honest signal: the " +
        "per-subscription retry fence re-subscribes on the new generation.",
      cause: new Error(
        `followingWire: generation ${now} superseded generation ${bound}`,
      ),
    }),
  });
}

export function followingWire<T extends WireTransport>(
  first: WireGeneration<T>,
): FollowingWire<T> {
  let held: WireGeneration<T> = first;
  let disposed = false;
  /** How many times this wire has adopted — the generation a call binds to. A
   *  call bound to a generation the wire has passed was superseded. */
  let generation = 0;
  const generationWatchers = new Set<(generation: number) => void>();

  // The status FUNNEL. `published` is the value `wire.status()` answers, so what
  // a watcher was told and what a reader reads can never disagree — including
  // across an `adopt`, where the two generations' own statuses may differ.
  let published: WireStatus = held.transport.wire.status();
  const watchers = new Set<(status: WireStatus) => void>();
  const publish = (next: WireStatus): void => {
    if (next === published) return;
    published = next;
    for (const watcher of watchers) watcher(next);
  };
  let detachStatus = held.transport.wire.onStatus(publish);

  /** Never succeeds; fails the moment the wire adopts past `bound`.
   *
   *  The registration is asynchronous relative to the `bindingGeneration()` read
   *  at the call site, so an `adopt` can complete in between — hence the eager
   *  re-check rather than an assumption. Straight from `websocketLink`'s epoch
   *  wrap, which answers the same question about a re-dial. */
  const supersededByAdopt = (
    bound: number,
  ): Effect.Effect<never, RpcClientError> =>
    Effect.callback<never, RpcClientError>((resume) => {
      if (generation > bound) {
        resume(Effect.fail(supersededError(bound, generation)));
        return;
      }
      const watcher = (next: number): void => {
        if (next <= bound) return;
        generationWatchers.delete(watcher);
        resume(Effect.fail(supersededError(bound, next)));
      };
      generationWatchers.add(watcher);
      return Effect.sync(() => {
        generationWatchers.delete(watcher);
      });
    });

  // Branded: `brandHalfOpenDispatch` is by IDENTITY and this is a new object.
  // A wire dispatch that lost the brand would be accepted by `surfaceClient`
  // with no watchdog — the green-dot-over-a-dead-link lie (#1564).
  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    unary: (tag: string, payload: unknown) =>
      // `suspend` so the generation is read when the call RUNS, not when its
      // lazy value is built (a call value can be held and run much later).
      Effect.suspend(() =>
        Effect.raceFirst(
          held.transport.dispatch.unary(tag, payload),
          supersededByAdopt(generation),
        ),
      ),
    stream: (tag: string, payload: unknown) =>
      // `interruptWhen`, not `haltWhen`: a superseded subscription is parked ON
      // a pull that will never complete, and `haltWhen` waits for the current
      // pull. The guard's FAILURE becomes the stream's failure, which is what
      // the fence retries on. It cannot fire synchronously with the subscribe
      // (the generation is read in the same tick it is compared against), so
      // `SurfaceDispatch`'s no-synchronous-end invariant still holds.
      Stream.suspend(() =>
        Stream.interruptWhen(
          held.transport.dispatch.stream(tag, payload),
          supersededByAdopt(generation),
        ),
      ),
  });

  return {
    dispatch,
    current: () => held.transport,
    wire: {
      status: () => published,
      onStatus: (cb) => {
        watchers.add(cb);
        return () => {
          watchers.delete(cb);
        };
      },
      // A drop is the CURRENT generation's own business — the following wire
      // adds no recovery of its own, it only forwards.
      forceReconnect: () => held.transport.wire.forceReconnect(),
    },
    adopt: async (next) => {
      if (disposed) {
        throw new Error(
          "followingWire: `adopt` on a disposed wire — the generation handed in " +
            "would be held by nothing and closed by nobody. Dispose the generation " +
            "instead, or adopt before disposing the wire.",
        );
      }
      const superseded = held;
      detachStatus();
      held = next;
      detachStatus = next.transport.wire.onStatus(publish);
      // The counter FIRST, so a consumer that issues a call from its own status
      // handler below has already bound to the new generation and cannot fail
      // its own fresh call. Then the status, then the supersession sweep — the
      // order `websocketLink`'s open edge takes, for the same reason.
      generation += 1;
      publish(next.transport.wire.status());
      for (const watcher of [...generationWatchers]) watcher(generation);
      // AFTER the swap: the handover above is synchronous, so there is no window
      // in which this wire has no generation, and a `dispose()` landing during
      // this await releases the generation now held rather than the corpse.
      await superseded.dispose();
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      detachStatus();
      await held.dispose();
    },
  };
}
