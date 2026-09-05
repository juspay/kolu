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
 *     the page. It is the ONE asynchronous half, and `adopt` hands it back as a
 *     promise rather than being one: `adopt` itself is a plain function that
 *     swaps and refuses synchronously, so "the wire is never between
 *     generations" is a claim about the statement a caller wrote, not about a
 *     microtask schedule.
 *
 * ## What it is not
 *
 * Not a reconnect, and not a retry. A generation change is a deliberate act by
 * the consumer that dialled the replacement; a DROP is still the underlying
 * link's own business and is forwarded through `wire.onStatus` unchanged.
 */

import type { WireStatus, WireTransport } from "../link";
import { reportLeakedTeardown } from "../teardown";
import { supersession } from "./supersession";

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
  /** How many usable connections this wire has ESTABLISHED — 0 before the
   *  first, and monotonic for the wire's whole life, across every generation.
   *
   *  It answers a question the status funnel cannot, and a generation's own
   *  `diagnostics.epoch()` cannot either. The funnel is DEDUPLICATED, so
   *  adopting an already-open replacement — the ordinary shape of a roster
   *  move, since the replacement is dialled before the old one is given up —
   *  publishes nothing at all; and a generation's epoch counts one link's open
   *  edges and starts again at the next generation.
   *
   *  Both edges count, and only these: a reconnect INSIDE the held generation,
   *  and an `adopt` that lands on a connection. An `adopt` whose replacement is
   *  still `connecting` counts when that connection opens, not before — and a
   *  replacement that was never adopted (a dial that failed, a refused
   *  `adopt`) counts never, because no new connection was established.
   *
   *  What it is FOR: anything whose answer was computed FROM the connection
   *  rather than merely over it — a viewer identity resolved from the
   *  WebSocket upgrade's headers is the case that asked for it
   *  (juspay/olai#522). Such an answer is stale the moment a different socket
   *  carries the calls, while every subscription riding that socket has healed
   *  itself and says nothing. It is NOT a signal to rebuild anything: standing
   *  subscriptions re-open themselves, which is the whole point of this wire. */
  readonly establishments: () => number;
  /** Subscribe to {@link establishments}. The handler is called with the new
   *  count on each establishment; the returned function unsubscribes. */
  readonly onEstablished: (
    handler: (establishments: number) => void,
  ) => () => void;
  /** Take `next` as the generation every call from now on rides, fail whatever
   *  was in flight over the old one, and release it.
   *
   *  NOT `async`, and that is the whole contract rather than a detail: the swap
   *  is synchronous, so its REFUSAL must be too. Declared `async`, the
   *  disposed-wire guard came back as a rejected promise a microtask later —
   *  and a caller reading the return as "the superseded release" then ran its
   *  whole handover (move the clients, re-fold, announce the new roster) over a
   *  wire that had refused the generation, learning about it only after the
   *  damage. This throws where it decides, so a caller's next statement runs
   *  only if the wire really moved.
   *
   *  The RETURNED promise is the superseded generation's release — the one
   *  genuinely asynchronous half — and it never rejects: a teardown that fails
   *  is logged, because the value this call exists to produce is already
   *  delivered. Await it last, or not at all.
   *
   *  THROWS on a disposed wire: adopting onto one would open a generation
   *  nothing will ever close. It can also throw whatever a consumer's own
   *  `wire.onStatus` handler throws — that throw is the consumer's, not this
   *  wire's to swallow, and the superseded calls are swept regardless (the
   *  `finally` in `./supersession`). */
  adopt(next: WireGeneration<T>): Promise<void>;
  /** Release the generation currently held.
   *
   *  Idempotent — and a later call gets the SAME promise, and therefore the same
   *  verdict. An early `return` would resolve while the generation's teardown
   *  was still running, which is a `dispose()` claiming a release that has not
   *  happened. */
  dispose(): Promise<void>;
}

export function followingWire<T extends WireTransport>(
  first: WireGeneration<T>,
): FollowingWire<T> {
  let held: WireGeneration<T> = first;
  let disposed = false;
  /** The one release walk, once started. See `dispose` below. */
  let released: Promise<void> | undefined;

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

  // ── The CONNECTION EPOCH ────────────────────────────────────────────────
  //
  // How many usable connections this wire has ESTABLISHED, monotonic for its
  // whole life. It is not derivable from the status funnel, and that is the
  // whole reason it exists as its own fact: the funnel is deduplicated (a wire
  // that was `open` and is `open` has nothing to publish), so adopting an
  // ALREADY-OPEN replacement — the ordinary shape of a roster move, since the
  // replacement is dialled before the old one is given up — is a brand-new
  // socket that the status says nothing about. Nor is a generation's own
  // `diagnostics.epoch()` an answer: it counts one LINK's open edges and starts
  // again at the next generation.
  //
  // Who needs it: anything whose answer was computed FROM the connection rather
  // than over it. A surface app's viewer identity is the case that asked
  // (juspay/olai#522) — it is resolved from the WebSocket upgrade's headers, so
  // it is stale the moment a different socket carries the calls, while every
  // subscription riding that socket has healed itself and says nothing. Such a
  // consumer keys its own re-fetch on this number and gets it right on both
  // edges: a reconnect INSIDE a generation, and a generation change.
  let establishments = 0;
  const establishmentWatchers = new Set<(establishments: number) => void>();
  /** True while the generation currently held has a usable connection. The
   *  EDGE detector: only a false→true transition is a new establishment, and
   *  `adopt` clears it as the old generation goes, so an adopted-open
   *  replacement reads as the establishment it is. */
  let established = held.transport.wire.status() === "open";
  if (established) establishments = 1;
  const noteEstablished = (open: boolean): void => {
    if (open === established) return;
    established = open;
    if (!open) return;
    establishments += 1;
    // A COPY, so a watcher that unsubscribes itself mid-notify cannot perturb
    // the walk.
    for (const watcher of [...establishmentWatchers]) watcher(establishments);
  };

  /** ONE forwarder, used for every generation, so a status change and the
   *  establishment it may be are read off the same event rather than by two
   *  subscriptions that could see different things. */
  const forwardStatus = (next: WireStatus): void => {
    publish(next);
    noteEstablished(next === "open");
  };
  let detachStatus = held.transport.wire.onStatus(forwardStatus);

  /** Close a generation this wire has let go of. A release that itself FAILS is
   *  LOGGED, not raised: on the `adopt` path the value the call exists to
   *  produce — the new generation, live, with every superseded call already
   *  failed — is already delivered by the time the old one is closed, so
   *  rejecting over its teardown would tell the caller that a move which
   *  completed did not. (The same trade `trackConnectAllocations` makes at its
   *  own superseded exit, at the altitude that owns the resource.) */
  const releaseSuperseded = async (
    generation: WireGeneration<T>,
  ): Promise<void> => {
    try {
      await generation.dispose();
    } catch (teardownError) {
      reportLeakedTeardown(
        "followingWire: releasing the superseded generation FAILED — that link " +
          "is leaked; the wire is live on the generation it adopted",
        teardownError,
      );
    }
  };

  // THE FENCE — the shared one (`./supersession`), which `websocketLink` also
  // stands on. What this wire contributes is only three NOUNS: an operator
  // reading a console must be able to tell a generation change from a re-dial,
  // and that is the whole of the difference. The sentence they land in is the
  // law's, written once over there.
  const fence = supersession({
    moved: "the wire adopted a new generation",
    mark: "generation",
    carrier: "link",
    cause: (bound, now) =>
      `followingWire: generation ${now} superseded generation ${bound}`,
  });
  // `inner` is read PER CALL, so a call issued after an `adopt` rides the
  // generation now held; every call binds to the mark current when it RUNS.
  const dispatch = fence.wrap(() => held.transport.dispatch, fence.mark);

  return {
    dispatch,
    current: () => held.transport,
    establishments: () => establishments,
    onEstablished: (handler) => {
      establishmentWatchers.add(handler);
      return () => {
        establishmentWatchers.delete(handler);
      };
    },
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
    // NOT `async`: the swap is synchronous and so is every refusal it makes. A
    // rejected promise here would let a caller's whole handover run before it
    // could learn the wire had not moved. What it RETURNS is the one
    // asynchronous half — the superseded generation's release.
    adopt: (next) => {
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
      // The generation that carried the last connection is gone, so the edge
      // detector is armed BEFORE the new generation can be observed. Without
      // this an already-open replacement would read as "still open" and the
      // establishment it is would go uncounted.
      noteEstablished(false);
      // THE SWAP HAS HAPPENED, so the release is owed UNCONDITIONALLY from here
      // — hence the `finally`. Everything between is a consumer's code reached
      // through a callback (`onStatus`, and the status handlers `advance`
      // notifies), and a consumer may throw. That throw is the consumer's and
      // must escape; what it must NOT do is skip the release, because
      // `superseded` is the last reference to a link that is no longer `held`.
      // Written as a plain statement after `advance`, exactly that happened: a
      // throwing status watcher — the case this wire has a test for — unwound
      // `adopt` before the release was ever started, and the old socket kept its
      // reconnect schedule, its ping fiber and its observers for the life of the
      // page. A caller cannot clean that up either: the wire HAS taken the new
      // generation, so `dispose()` closes that one and the corpse is unreachable.
      let release: Promise<void>;
      try {
        detachStatus = next.transport.wire.onStatus(forwardStatus);
        // ADVANCE → publish → sweep, as ONE call, because the order is the whole
        // point and `./supersession` is where it is stated: the mark moves first
        // so a consumer that issues a call from its own status handler has
        // already bound to the new generation and cannot fail its own fresh call,
        // and the sweep runs last (in a `finally`) so a throwing handler cannot
        // leave the superseded calls with nothing to fail them.
        //
        // A new usable connection may be established by this very statement (an
        // already-open replacement), which the funnel has nothing to publish
        // about — see {@link noteEstablished}.
        fence.advance(() => {
          publish(next.transport.wire.status());
          noteEstablished(next.transport.wire.status() === "open");
        });
      } finally {
        release = releaseSuperseded(superseded);
      }
      return release;
    },
    // THE ONE release, memoized. A second `dispose()` gets the SAME promise and
    // therefore the same verdict — an early `return` would resolve while the
    // generation's teardown was still running, which is exactly the lie
    // `trackConnectAllocations` memoizes its walk to avoid and the one
    // `surfaceClients`' bundle raises rather than tell.
    dispose: () =>
      (released ??= (async () => {
        disposed = true;
        detachStatus();
        await held.dispose();
      })()),
  };
}
