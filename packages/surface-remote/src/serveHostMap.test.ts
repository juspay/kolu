/**
 * `serveHostMap` — the pool → `SurfaceMap` `MapRegistry` adapter. Pinned NODE-side
 * (no solid client): the `SessionState → EntryConnectionState` projection as a pure
 * fn, `buildRemotePool.subscribe`'s ordering, and — the coordinator-mandated pin — a
 * STATUS transition (warming → connected) republishing the served `entries` stream
 * WITHOUT a membership change (the fused membership + `onState` subscribe).
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import {
  defineSurfaceMap,
  type EntryStatus,
  type KeyCodec,
} from "@kolu/surface-map";
import type { AnyContractRouter } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRemotePool } from "./hostFanout";
import { projectState, serveHostMap } from "./serveHostMap";
import type { Session, SessionState } from "./session";

const entrySurface = defineSurface({
  cells: {
    info: {
      schema: z.object({ v: z.number() }),
      default: { v: 0 },
      verbs: ["get"],
    },
  },
});
const HostKey = z.string().brand("HostKey");
// The test's own key IS already a plain (branded) string, so its codec is the
// identity pair — see `hostKeyCodec` in `kolu-common/hostKey` for the real,
// object-keyed case this codec seam exists for.
const identityCodec: KeyCodec<z.infer<typeof HostKey>> = {
  encode: (k) => k,
  decode: (s) => s as z.infer<typeof HostKey>,
};
const map = defineSurfaceMap(HostKey, entrySurface, identityCodec);

/** Build a `SessionState` for the given `connection` phase. The DOWN arm
 *  (`disconnected`/`failed`) now REQUIRES a real `lastError` — the type no
 *  longer admits "down with no reason" — so this throws rather than silently
 *  defaulting one in, mirroring the production invariant at the test-helper
 *  boundary. */
const st = (
  connection: SessionState["connection"],
  lastError?: string,
): SessionState => {
  if (connection === "disconnected" || connection === "failed") {
    if (lastError === undefined) {
      throw new Error(`st(${connection}): a down arm requires a lastError`);
    }
    return {
      connection,
      progressLines: [],
      remoteProgressLines: [],
      lastError,
      failureCause: "remote",
    };
  }
  return { connection, progressLines: [], remoteProgressLines: [] };
};

type FakeSession = Session & { clockOffset(): number | null };

/** `provisions` defaults `true` — the ssh arm, per `session.ts`'s own doc ("Prov =
 *  ProvisioningPhase (the ssh arm, the default)"). Pass `false` to model a
 *  non-provisioning (local/endpoint) session — the runtime twin of `Prov = never`. */
function fakeSession(
  initial: SessionState,
  offset: number | null,
  provisions = true,
) {
  let state = initial;
  let clockOffset = offset;
  const listeners = new Set<(s: SessionState) => void>();
  const session = {
    onState(cb: (s: SessionState) => void) {
      cb(state);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clockOffset: () => clockOffset,
    destroy() {},
    provisions,
  } as unknown as FakeSession;
  return {
    session,
    setState(next: SessionState) {
      state = next;
      for (const l of [...listeners]) l(next);
    },
    setOffset(o: number | null) {
      clockOffset = o;
    },
  };
}

function fakePool() {
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const listeners = new Set<() => void>();
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const pool = {
    hosts: () => [...sessions.keys()],
    has: (h: string) => sessions.has(h),
    getSession: (h: string): FakeSession | undefined =>
      sessions.get(h)?.session,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return {
    pool,
    add(h: string, s: ReturnType<typeof fakeSession>) {
      sessions.set(h, s);
      fire(); // fire AFTER the Map mutation (ordering), as buildRemotePool does
    },
    remove(h: string) {
      sessions.delete(h);
      fire();
    },
  };
}

/** Consume the served `entries.get({key})` stream node-side. */
async function entriesGet(
  link: unknown,
  key: string,
): Promise<AsyncIterator<EntryStatus>> {
  // biome-ignore lint/suspicious/noExplicitAny: walk the served oRPC link by string
  const iterable = await (link as any).surface.entries.get({ key });
  return iterable[Symbol.asyncIterator]();
}

describe("projectState — SessionState → EntryConnectionState", () => {
  it("maps each connection state, gating `connected` on the measured offset", () => {
    expect(projectState(st("copying"), 5)).toEqual({ kind: "copying" });
    expect(projectState(st("connecting"), 5)).toEqual({ kind: "connecting" });
    expect(projectState(st("connected"), 5)).toEqual({
      kind: "connected",
      clockOffset: 5,
    });
    // connected but no offset yet → still settling (connected REQUIRES the offset).
    expect(projectState(st("connected"), null)).toEqual({ kind: "connecting" });
    expect(projectState(st("disconnected", "boom"), 5)).toEqual({
      kind: "disconnected",
      reason: "boom",
    });
    expect(projectState(st("failed", "dead"), 5)).toEqual({
      kind: "failed",
      reason: "dead",
    });
    // NOTE: a down state with NO reason is no longer constructible at all — the
    // `SessionState` sum requires `lastError` on `disconnected`/`failed` (see
    // `st()` above), so the old "reason coalesces a null lastError" case (the
    // `?? "disconnected"` fallback `projectState` used to need) has no
    // representable input to test; the fallback itself was deleted as dead code.
    expect(projectState(undefined, 5)).toEqual({ kind: "connecting" });
  });
});

describe("serveHostMap belt — a non-provisioning session can never project 'copying' (juspay/kolu#1716)", () => {
  it("RUNTIME pin: a PROVISIONING session in 'copying' projects 'copying' fine (the remote path warms-via-copy)", async () => {
    const p = fakePool();
    p.add("remote", fakeSession(st("copying"), 0, true)); // provisions: true — legitimate
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
    });
    const iter = await entriesGet(
      directLink<AnyContractRouter>(served.router as never),
      "remote",
    );
    // The remote entry warms-via-copy honestly — no throw, status is 'warming'.
    await expect(iter.next()).resolves.toMatchObject({
      value: { kind: "warming" },
    });
    served.dispose();
  });

  it("BELT: a non-provisioning session in 'copying' (an illegal state the endpoint TYPE forbids at construction) throws LOUD instead of a lying 'warming' chip", async () => {
    const p = fakePool();
    // Force a non-provisioning session into "copying" — the endpoint arm's type
    // (`makeSession<_, never>`) makes this UNCONSTRUCTIBLE, so this models a
    // regression / a wrong widening.
    p.add("local", fakeSession(st("copying"), 0, false));
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
    });
    const iter = await entriesGet(
      directLink<AnyContractRouter>(served.router as never),
      "local",
    );
    await expect(iter.next()).rejects.toThrow(/never inhabit|1716/);
    served.dispose();
  });

  it("GENERALIZATION: the belt checks EVERY non-provisioning session, not just one nominated key — a second offender is caught too", async () => {
    const p = fakePool();
    // Two independent non-provisioning members, both illegally in "copying" — the
    // old `localKey?: K` option could only ever belt ONE of these.
    p.add("local-a", fakeSession(st("copying"), 0, false));
    p.add("local-b", fakeSession(st("copying"), 0, false));
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
    });
    const link = directLink<AnyContractRouter>(served.router as never);
    const iterA = await entriesGet(link, "local-a");
    const iterB = await entriesGet(link, "local-b");
    await expect(iterA.next()).rejects.toThrow(/never inhabit|1716/);
    await expect(iterB.next()).rejects.toThrow(/never inhabit|1716/);
    served.dispose();
  });
});

describe("buildRemotePool.subscribe — membership, ordering", () => {
  it("fires after add/remove/destroyAll, with hosts()/has() already reflecting the change", async () => {
    const built = buildRemotePool<Session, unknown>({
      initialHosts: ["a"],
      buildEntry: () => ({
        session: { destroy() {} } as unknown as Session,
        handler: null,
      }),
    });
    const seen: string[][] = [];
    built.subscribe(() => seen.push(built.hosts()));
    await built.add("b");
    expect(seen.at(-1)).toEqual(["a", "b"]); // add reflected BEFORE the fire
    expect(built.has("b")).toBe(true);
    await built.remove("a");
    expect(seen.at(-1)).toEqual(["b"]);
    built.destroyAll();
    expect(seen.at(-1)).toEqual([]);
  });
});

describe("serveHostMap — entries authority", () => {
  it("THE PIN: a warming→connected STATUS transition republishes entries with NO membership change", async () => {
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      // dummy entry link — this pin exercises `entries`, not member forwarding
      linkFor: () => ({ surface: {} }),
    });
    const link = directLink<AnyContractRouter>(
      // biome-ignore lint/suspicious/noExplicitAny: served router
      served.router as any,
    );
    const s = fakeSession(st("connecting"), 42);
    pf.add("a", s);

    const iter = await entriesGet(link, "a");
    expect((await iter.next()).value).toEqual({ kind: "warming" }); // connecting → warming

    // A PURE status transition (no add/remove) must reach the entries stream.
    const pending = iter.next();
    s.setState(st("connected"));
    expect((await pending).value).toEqual({
      kind: "connected",
      clockOffset: 42,
    });
    served.dispose();
  });

  it("membership add drives entries.keys()", async () => {
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      linkFor: () => ({ surface: {} }),
    });
    const link = directLink<AnyContractRouter>(
      // biome-ignore lint/suspicious/noExplicitAny: served router
      served.router as any,
    );
    // biome-ignore lint/suspicious/noExplicitAny: walk the served link by string
    const keysIter = (await (link as any).surface.entries.keys(undefined))[
      Symbol.asyncIterator
    ]();
    expect((await keysIter.next()).value).toEqual([]); // no members yet
    pf.add("a", fakeSession(st("connected"), 0));
    expect((await keysIter.next()).value).toEqual(["a"]);
    served.dispose();
  });
});
