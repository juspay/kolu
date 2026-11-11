/**
 * THE PORT'S TWO AXES — membership and reachability — and the one thing that
 * is easy to get wrong about watching both: a host's `onState` is
 * snapshot-then-delta, so attaching to it fires immediately, and every dial
 * walks several phases that all mean the same word to the fleet. A subscriber
 * woken for either would republish the whole roster a dozen times per
 * reconnect and once per host at startup for nothing.
 *
 * The pool is a stand-in rather than a real `buildRemotePool`: what is under
 * test is the FOLD (phase → word) and the notification discipline, and a real
 * pool would make the test about ssh and spawning instead.
 */

import type { padiSurface } from "@kolu/padi-client/surface";
import type { RemotePool, ReServedSurface } from "@kolu/surface-remote";
import { describe, expect, test } from "vitest";
import type { PadiSession } from "../padi/padiSession.ts";
import { fleetHostsOver } from "./fleetHosts.ts";

type Phase = "connecting" | "connected" | "failed" | "absent";

/** A stub host: the session the port reads, plus the lever this file moves it
 *  with. */
interface HostStub {
  readonly session: PadiSession;
  move(next: Phase): void;
}

/** One host's session, with its phase movable by hand. Only the members the
 *  port reads are implemented; anything else it reached for would be a defect
 *  this stub should NOT paper over, so the cast is narrow and deliberate. */
const sessionStub = (phase: Phase): HostStub => {
  const listeners = new Set<() => void>();
  let current = phase;
  return {
    session: {
      isDestroyed: () => false,
      currentState: () => ({ phase: current }),
      onState: (cb: () => void) => {
        listeners.add(cb);
        // Snapshot-then-delta, exactly as `makeSession` does it: the current
        // frame fires synchronously, from inside this call.
        cb();
        return () => listeners.delete(cb);
      },
    } as unknown as PadiSession,
    move: (next: Phase) => {
      current = next;
      for (const cb of [...listeners]) cb();
    },
  };
};

/** A stub pool: what the port reads, plus the lever for the OTHER axis. */
interface PoolStub {
  readonly pool: RemotePool<PadiSession, undefined>;
  drop(key: string): void;
}

/** A pool over a mutable host list. `subscribe` fires only on MEMBERSHIP, the
 *  real pool's contract — which is exactly why the port needs a second axis. */
const poolStub = (entries: Array<[string, HostStub]>): PoolStub => {
  const live = new Map(entries);
  const watchers = new Set<() => void>();
  return {
    pool: {
      hosts: () => [...live.keys()],
      has: (h: string) => live.has(h),
      getSession: (h: string) => live.get(h)?.session,
      subscribe: (cb: () => void) => {
        watchers.add(cb);
        return () => watchers.delete(cb);
      },
    } as unknown as RemotePool<PadiSession, undefined>,
    drop: (key: string) => {
      live.delete(key);
      for (const cb of [...watchers]) cb();
    },
  };
};

/** The composition root's cache, stubbed: a mirror with no bound handlers. The
 *  port only ever BUILDS a face over it here — calling a verb is the fleet
 *  face's business and belongs to its own tests. */
const mirror = {
  handlers: {},
} as unknown as ReServedSurface<typeof padiSurface.spec>;

describe("the fleet's view of kolu's host map", () => {
  test("names hosts in the pool's order and spells each one the way a person does", () => {
    const local = sessionStub("connected");
    const prod = sessionStub("connected");
    const { pool } = poolStub([
      ["local", local],
      ["remote:prod", prod],
    ]);
    const hosts = fleetHostsOver({
      pool,
      reServeFor: () => mirror,
      localName: "sparrow",
    });
    expect(hosts.keys()).toEqual(["local", "remote:prod"]);
    // The local machine by its hostname, a remote by its ssh target: an agent
    // holding three hosts at once can do nothing with the word "local".
    expect(hosts.display("local")).toBe("sparrow");
    expect(hosts.display("remote:prod")).toBe("prod");
  });

  test("folds every phase to the fleet's three words, and hands no client to a host that is not connected", () => {
    const warming = sessionStub("connecting");
    const gone = sessionStub("failed");
    const away = sessionStub("absent");
    const up = sessionStub("connected");
    const { pool } = poolStub([
      ["local", up],
      ["remote:a", warming],
      ["remote:b", gone],
      ["remote:c", away],
    ]);
    const hosts = fleetHostsOver({
      pool,
      reServeFor: () => mirror,
      localName: "sparrow",
    });
    expect(hosts.state("local")).toBe("connected");
    expect(hosts.state("remote:a")).toBe("warming");
    // A give-up and a far end that is not there are the same answer to an
    // agent; the difference is the host-map entry a person reads.
    expect(hosts.state("remote:b")).toBe("failed");
    expect(hosts.state("remote:c")).toBe("failed");
    // A host nobody holds a session for is not warming toward anything.
    expect(hosts.state("remote:nothing")).toBe("failed");

    expect(hosts.padi("local")).not.toBeNull();
    // NULL, not an empty answer: the face turns this into a refusal naming the
    // host and its state, which is the whole point of the pair.
    expect(hosts.padi("remote:a")).toBeNull();
    expect(hosts.padi("remote:b")).toBeNull();
    expect(hosts.padi("remote:nothing")).toBeNull();
  });

  test("the same mirror yields the same client, so a face does not re-walk the surface per call", () => {
    const up = sessionStub("connected");
    const { pool } = poolStub([["local", up]]);
    const hosts = fleetHostsOver({
      pool,
      reServeFor: () => mirror,
      localName: "sparrow",
    });
    expect(hosts.padi("local")).toBe(hosts.padi("local"));
  });

  test("wakes on reachability AND membership, and never merely on attaching", () => {
    const local = sessionStub("connecting");
    const prod = sessionStub("connected");
    const { pool, drop } = poolStub([
      ["local", local],
      ["remote:prod", prod],
    ]);
    const hosts = fleetHostsOver({
      pool,
      reServeFor: () => mirror,
      localName: "sparrow",
    });

    let woken = 0;
    const off = hosts.subscribe(() => {
      woken += 1;
    });
    // ATTACHING IS NOT NEWS. Every session fired its snapshot frame during
    // `subscribe`; a port that forwarded those would wake its caller once per
    // host before anything had happened.
    expect(woken).toBe(0);

    // A phase that means the same WORD is not news either — the fleet says
    // `warming` through every dialing phase, and a reconnect walks several.
    local.move("connecting");
    expect(woken).toBe(0);

    // A real move is.
    local.move("connected");
    expect(woken).toBe(1);
    prod.move("failed");
    expect(woken).toBe(2);

    // ... and so is a host leaving, which `onState` can never say.
    drop("remote:prod");
    expect(woken).toBe(3);
    expect(hosts.keys()).toEqual(["local"]);

    // Unsubscribed is unsubscribed, on both axes.
    off();
    local.move("failed");
    drop("local");
    expect(woken).toBe(3);
  });
});
