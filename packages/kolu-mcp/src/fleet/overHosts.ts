/**
 * FOLLOWING EVERY CONNECTED HOST OVER TIME — the one implementation of "open a
 * stream per host that is answering, and open it again when the host map
 * moves".
 *
 * Two readers need exactly this: the fleet face's aggregate members (`face.ts`
 * — every connected host's own `terminals.keys` / `urgency`, folded into one
 * fleet-wide answer) and the Conductor's standing watch in kolu-server
 * (`packages/server/src/conductor/watcher.ts`). Written twice they drift in
 * the place it costs most: WHICH CLIENT a leg is read through. A padi that
 * dropped and came back hands out a different client object for the same host
 * key, and a subscription still running over the old one is reading a daemon
 * that has never heard of it. Decided ONCE here — `hosts.padi(host)` is
 * re-read inside the switch, on every move of the map — a leg can only exist
 * over the client that is current. The other half of the same rule is the
 * silence: a host that is not connected gets no leg at all rather than a leg
 * that answers emptily, which is what lets the face refuse it BY NAME and the
 * watch say nothing about its terminals until it is back.
 *
 * ## A leaf, not an electricity
 *
 * By the three tests in `docs/atlas/src/content/atlas/electricity.mdx`: ① it is
 * NOT domain-agnostic — its whole interface IS `FleetHosts`, kolu's own host
 * map; ③ nothing outside this repo plugs in, one repo and two consumers, both
 * kolu's; and ② the hard volatility it looks like it owns — a host's link
 * coming and going, a mirror that re-dials — is ALREADY encapsulated, by
 * kolu-server's host map behind the port one file over (`subscribe` and a
 * nullable `padi` are that receptacle). What is left here is stream arithmetic
 * over it: the atlas's own definition of a leaf rather than a receptacle, so
 * it lives beside the port both consumers already share and is not a `@kolu/*`
 * package.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { Effect, Queue, Stream } from "effect";
import type { FleetHosts } from "./hosts.ts";

/** The roster, now and on every move. The payload is the host keys; readers
 *  that only need the CHANGE ignore it and re-read what they care about. */
export function hostRoster(
  hosts: FleetHosts,
): Stream.Stream<readonly string[]> {
  return Stream.callback<readonly string[]>((queue) =>
    Effect.gen(function* () {
      const push = (): void => {
        Queue.offerUnsafe(queue, hosts.keys());
      };
      // Emit the current roster BEFORE subscribing: a resource read takes the
      // first frame, and a stream that only spoke on change would make a read
      // of a quiet fleet hang forever.
      push();
      const off = hosts.subscribe(push);
      yield* Effect.addFinalizer(() => Effect.sync(off));
    }),
  );
}

/**
 * ONE LEG PER CONNECTED HOST, torn down and re-opened as the map moves.
 *
 * `per` is handed the host and its CLIENT and asked only which member to read
 * — it answers `null` for a host it has nothing to read on, which is how the
 * watch skips a machine holding no watched terminal. A seam where the caller
 * answered "is this host connected" as well would have both sides reaching for
 * `hosts.padi`, and `padi() !== null` is the test: the client is what a leg
 * actually reads, so a roster claiming `connected` over a client that is gone
 * would make the caller throw instead of answering short.
 *
 * `scope` is handed ONE generation of legs — which hosts are in it, and their
 * frames tagged with the host that produced each — and says what the generation
 * is worth as a stream. That is the whole difference between the two consumers
 * (the face folds a generation into one fleet-wide value and has to say
 * something when the generation is empty; the watch hands each frame straight
 * on), and it is the caller's to decide because only the caller knows what an
 * empty fleet MEANS to its reader.
 *
 * `switchMap`, so the previous generation's subscriptions are interrupted
 * before the next one's are opened: a leg outliving the map move that replaced
 * it is the stale-client bug this module exists to make impossible.
 */
export function overConnectedHosts<T, R>(
  hosts: FleetHosts,
  per: (
    host: string,
    padi: PadiSurfaceClient,
  ) => Stream.Stream<T, unknown> | null,
  scope: (
    live: readonly string[],
    frames: Stream.Stream<readonly [string, T], unknown>,
  ) => Stream.Stream<R, unknown>,
): Stream.Stream<R, unknown> {
  return Stream.switchMap(hostRoster(hosts), () => {
    const live: string[] = [];
    const legs: Stream.Stream<readonly [string, T], unknown>[] = [];
    for (const host of hosts.keys()) {
      const padi = hosts.padi(host);
      if (padi === null) continue;
      const leg = per(host, padi);
      if (leg === null) continue;
      live.push(host);
      legs.push(Stream.map(leg, (value) => [host, value] as const));
    }
    // Merged rather than zipped: each host answers on its own clock, and one
    // slow machine must not be able to withhold another's frame.
    return scope(live, Stream.mergeAll(legs, { concurrency: "unbounded" }));
  });
}
