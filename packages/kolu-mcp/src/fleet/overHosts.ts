import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { Effect, Queue, Stream } from "effect";
import type { FleetHosts } from "./hosts.ts";

export function hostRoster(
  hosts: FleetHosts,
): Stream.Stream<readonly string[]> {
  return Stream.callback<readonly string[]>((queue) =>
    Effect.gen(function* () {
      const push = (): void => {
        Queue.offerUnsafe(queue, hosts.keys());
      };
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
 * watch skips a machine holding no watched terminal.
 *
 * `scope` is handed ONE generation of legs — which hosts are in it, and their
 * frames tagged with the host that produced each — and says what the generation
 * is worth as a stream.
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
    return scope(live, Stream.mergeAll(legs, { concurrency: "unbounded" }));
  });
}
