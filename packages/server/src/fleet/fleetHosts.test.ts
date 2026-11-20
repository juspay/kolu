import { padiSurface } from "@kolu/padi-client/surface";
import { siblingTagPrefix, surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  type RemotePool,
  type SessionState,
  serveHostMap,
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

interface HostStub {
  readonly session: PadiSession;
  move(next: Phase): void;
}

const sessionStub = (phase: Phase, provisions = false): HostStub => {
  const listeners = new Set<(s: SessionState<string>) => void>();
  let current = frameFor(phase);
  return {
    session: {
      isDestroyed: () => false,
      currentState: () => current,
      provisions,
      entryFailedDetail: () => null,
      currentDispatch: () => undefined,
      onState: (cb: (s: SessionState<string>) => void) => {
        listeners.add(cb);
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

interface PoolStub {
  readonly pool: RemotePool<PadiSession, undefined>;
  drop(key: string): void;
}

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

const TERMINALS_KEYS = surfaceTag(padiSurface.tagPrefix, "terminals", "keys");

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
    expect(hosts.state("remote:b")).toBe("failed");
    expect(hosts.state("remote:c")).toBe("failed");
    expect(hosts.state("remote:nothing")).toBe("failed");

    expect(hosts.padi("local")).not.toBeNull();
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
    expect(woken).toBe(0);

    local.move("connecting");
    expect(woken).toBe(0);

    local.move("connected");
    expect(woken).toBe(1);
    prod.move("failed");
    expect(woken).toBe(2);

    drop("remote:prod");
    expect(woken).toBe(3);
    expect(hosts.keys()).toEqual(["local"]);

    off();
    local.move("failed");
    drop("local");
    expect(woken).toBe(3);
  });
});
