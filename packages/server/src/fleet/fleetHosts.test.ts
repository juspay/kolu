/**
 * THE PORT'S TWO AXES — membership and reachability — and the one thing that
 * is easy to get wrong about watching both: a host's `onState` is
 * snapshot-then-delta, so attaching to it fires immediately, and every dial
 * walks several phases that all mean the same word to the fleet. A subscriber
 * woken for either would republish the whole roster a dozen times per
 * reconnect and once per host at startup for nothing.
 *
 * ... and THE THIRD AXIS, which is why the agent's hands were empty on a live
 * deploy while the browser read the same hosts fine: the CLIENT the port hands
 * out has to speak to the surface this process actually serves.
 *
 * This file used to stub that away. The re-serve was `{ handlers: {} }` and the
 * comment beside it said calling a verb "belongs to the fleet face's own
 * tests" — which hold hand-built padi objects, so nothing anywhere called a
 * padi member through kolu-server's own mounting. The mounting was wrong:
 * `padiClientOver` builds padi's face from `padiSurfaceSibling`
 * (`surface/padi/*` — the tags the HOST MAP serves) and it was pointed at the
 * per-host re-serve, whose handlers are the ENTRY surface's standalone
 * `surface/*`. Every terminal-level call died with `no handler bound at
 * "surface/padi/terminals/keys"`, and no test could see it because no test
 * dialled.
 *
 * So the fixture here is the PRODUCTION MOUNTING: the real `padiHostMap`,
 * served by the real `serveHostMap` over the real `entryDispatch`, with only
 * the pool, the sessions and the per-host mirror HANDLERS stood in for. A face
 * built from a different surface than that runtime cannot pass — it fails in
 * `directDispatch`'s own fail-loud resolver, with the sentence the deploy
 * produced.
 *
 * The pool is a stand-in rather than a real `buildRemotePool`: what is under
 * test is the FOLD (phase → word), the notification discipline and the
 * binding, and a real pool would make the test about ssh and spawning instead.
 */

import { padiSurface } from "@kolu/padi-client/surface";
import { siblingTagPrefix, surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  type RemotePool,
  serveHostMap,
  type SessionState,
  sessionConnection,
} from "@kolu/surface-remote";
import { Effect, Option, Stream } from "effect";
import { encodeHostKey } from "kolu-common/hostKey";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import { describe, expect, test } from "vitest";
import { entryDispatch } from "../padi/entryDispatch.ts";
import { type PadiSession, padiFailureOf } from "../padi/padiSession.ts";
import { fleetHostsOver } from "./fleetHosts.ts";

type Phase = "connecting" | "connected" | "failed" | "absent";

/** One session frame per phase, in the shape `makeSession` stamps — the map
 *  validates a connected frame against `ConnectionInfoSchema` on its way to the
 *  entry's fine `connection` payload, so a half-built frame would fail there
 *  rather than where the test is looking. */
const frameFor = (phase: Phase): SessionState<string> =>
  phase === "connected"
    ? { phase, log: [], sinceMs: 0, campaignEpoch: 0, clockOffset: null }
    : phase === "connecting"
      ? { phase, log: [], sinceMs: 0, campaignEpoch: 0 }
      : {
          phase,
          log: [],
          sinceMs: 0,
          campaignEpoch: 0,
          error: "stub: the link is down",
          cause: "network",
        };

/** A stub host: the session the port reads, plus the lever this file moves it
 *  with. */
interface HostStub {
  readonly session: PadiSession;
  move(next: Phase): void;
}

/** One host's session, with its phase movable by hand. Only the members the
 *  port and `serveHostMap` read are implemented; anything else reached for
 *  would be a defect this stub should NOT paper over, so the cast is narrow
 *  and deliberate. */
const sessionStub = (phase: Phase, provisions = false): HostStub => {
  const listeners = new Set<(s: SessionState<string>) => void>();
  let current = frameFor(phase);
  return {
    session: {
      isDestroyed: () => false,
      currentState: () => current,
      provisions,
      entryFailedDetail: () => null,
      // No live link: an entry member is MIRRORED (the handlers below), and a
      // sibling's would be forwarded down a link this stub does not have —
      // which `entryDispatch` refuses by name, exactly as a host mid-reconnect
      // does in production.
      currentDispatch: () => undefined,
      onState: (cb: (s: SessionState<string>) => void) => {
        listeners.add(cb);
        // Snapshot-then-delta, exactly as `makeSession` does it: the current
        // frame fires synchronously, from inside this call.
        cb(current);
        return () => listeners.delete(cb);
      },
    } as unknown as PadiSession,
    move: (next: Phase) => {
      current = frameFor(next);
      for (const cb of [...listeners]) cb(current);
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

/** The tag a host's own padi serves its terminal key set at — minted by the
 *  framework off `padiSurface`'s own prefix, never typed out as a string. That
 *  is the whole point: the fixture's handler lands where the ENTRY surface
 *  binds, and the client has to reach it the way production does (through the
 *  map) rather than by dialling this tag itself. */
const TERMINALS_KEYS = surfaceTag(padiSurface.tagPrefix, "terminals", "keys");

/** kolu-server's padi mounting, verbatim from `index.ts`: the real map, the
 *  real per-entry dispatch, the real failure classifier and the real fine
 *  connection projection. Only the pool, the sessions and the per-host MIRROR
 *  are the test's — and the mirror is a handler record keyed by the ENTRY
 *  surface's own full wire tags, which is what `reServeSurface` binds
 *  (`implementSurfaceOnPublisher` over `padiSurface`, served verbatim). A
 *  fixture that keyed them any other way would be testing a mounting
 *  kolu-server does not have. */
const serveMap = (
  pool: RemotePool<PadiSession, undefined>,
  terminalsByHost: Readonly<Record<string, readonly string[]>>,
) => {
  const siblingTagPrefixes = Object.keys(padiHostMap.siblings).map(
    siblingTagPrefix,
  );
  return serveHostMap(padiHostMap, pool, {
    dispatchFor: (host, session) => {
      const enc = encodeHostKey(host);
      return entryDispatch({
        siblingTagPrefixes,
        mirror: directDispatch({
          handlers: {
            [TERMINALS_KEYS]: () => Stream.make(terminalsByHost[enc] ?? []),
          } as unknown as SurfaceHandlers,
        }),
        link: () => session.currentDispatch?.(),
        host: enc,
      });
    },
    failureOf: (_host, session, state) =>
      padiFailureOf(session.provisions, session.entryFailedDetail(), state),
    connection: {
      project: sessionConnection,
      isConnected: (c) => c.phase === "connected",
    },
  });
};

describe("the fleet's view of kolu's host map", () => {
  test("names hosts in the pool's order and spells each one the way a person does", () => {
    const local = sessionStub("connected");
    const prod = sessionStub("connected", true);
    const { pool } = poolStub([
      ["local", local],
      ["remote:prod", prod],
    ]);
    const hosts = fleetHostsOver({
      pool,
      padiMap: serveMap(pool, {}),
      localName: "sparrow",
    });
    expect(hosts.keys()).toEqual(["local", "remote:prod"]);
    // The local machine by its hostname, a remote by its ssh target: an agent
    // holding three hosts at once can do nothing with the word "local".
    expect(hosts.display("local")).toBe("sparrow");
    expect(hosts.display("remote:prod")).toBe("prod");
  });

  test("folds every phase to the fleet's three words, and hands no client to a host that is not connected", () => {
    const warming = sessionStub("connecting", true);
    const gone = sessionStub("failed", true);
    const away = sessionStub("absent", true);
    const up = sessionStub("connected");
    const { pool } = poolStub([
      ["local", up],
      ["remote:a", warming],
      ["remote:b", gone],
      ["remote:c", away],
    ]);
    const hosts = fleetHostsOver({
      pool,
      padiMap: serveMap(pool, {}),
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

  test("the same session yields the same client, so a face does not re-walk the surface per call", () => {
    const up = sessionStub("connected");
    const { pool } = poolStub([["local", up]]);
    const hosts = fleetHostsOver({
      pool,
      padiMap: serveMap(pool, {}),
      localName: "sparrow",
    });
    expect(hosts.padi("local")).toBe(hosts.padi("local"));
  });

  test("a host's client reaches that host's padi THROUGH the served map", async () => {
    // THE REGRESSION. The call below is the one an agent's first `terminals`
    // read makes, and it crosses every seam the deploy crossed: padi's own
    // face at `surface/padi/*`, the map's `{ mapKey, input }` envelope, the
    // map's membership + entry-state gate, the per-entry dispatch, the
    // mirror's standalone tags. Bound to anything but the served map it raises
    // `no handler bound at "surface/padi/terminals/keys"` instead of answering.
    const local = sessionStub("connected");
    const prod = sessionStub("connected", true);
    const { pool } = poolStub([
      ["local", local],
      ["remote:prod", prod],
    ]);
    const hosts = fleetHostsOver({
      pool,
      padiMap: serveMap(pool, {
        local: ["t-local-1", "t-local-2"],
        "remote:prod": ["t-prod-1"],
      }),
      localName: "sparrow",
    });

    const padi = hosts.padi("local");
    expect(padi).not.toBeNull();
    expect(
      await Effect.runPromise(
        Stream.runHead(padi!.surface.terminals.keys(undefined)),
      ),
    ).toEqual(Option.some(["t-local-1", "t-local-2"]));

    // ... and the KEY is what picks the host, not the client: a second host's
    // client folds its own `mapKey` into the same handlers and gets its own
    // machine's answer. A fold that dropped the key would answer the first
    // host's terminals for every host on the fleet.
    const other = hosts.padi("remote:prod");
    expect(other).not.toBeNull();
    expect(
      await Effect.runPromise(
        Stream.runHead(other!.surface.terminals.keys(undefined)),
      ),
    ).toEqual(Option.some(["t-prod-1"]));
  });

  test("wakes on reachability AND membership, and never merely on attaching", () => {
    const local = sessionStub("connecting");
    const prod = sessionStub("connected", true);
    const { pool, drop } = poolStub([
      ["local", local],
      ["remote:prod", prod],
    ]);
    const hosts = fleetHostsOver({
      pool,
      padiMap: serveMap(pool, {}),
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
