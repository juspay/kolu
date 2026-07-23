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
import {
  type ConnectionInfo,
  ConnectionInfoSchema,
  sessionConnection,
} from "./connection";
import { buildRemotePool } from "./hostFanout";
import {
  ConnectionAuthorityMismatchError,
  projectState,
  serveHostMap,
  UnclassifiedHostFailureError,
  UnclassifiedHostSessionError,
} from "./serveHostMap";
import type { DownSessionState, Session, SessionState } from "./session";
import type { SshProv } from "./sshConnector";

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
// A minimal domain failure schema (PR4) — the map's `failed` arm validates against it.
const failureSchema = z.object({ cause: z.string(), reason: z.string() });
type TestFailure = z.infer<typeof failureSchema>;
const map = defineSurfaceMap({
  key: HostKey,
  entry: entrySurface,
  codec: identityCodec,
  failure: failureSchema,
  // SR9: the map carries the FINE connection payload (`ConnectionInfo`) on its entries,
  // so a consumer derives BOTH the coarse dot and the fine word from the SAME entry.
  connection: ConnectionInfoSchema,
});

// The SR9 fine-connection option the padi call site injects — `sessionConnection` (the
// shared seam production uses) plus the connected-discriminant serveHostMap asserts the
// coarse dot against.
const connection = {
  project: sessionConnection,
  isConnected: (c: ConnectionInfo) => c.phase === "connected",
};

/** A test `failureOf` — classifies a DOWN state's transport `error` into the
 *  schema-valid failure. `failureOf` is only ever invoked on a genuinely-down state,
 *  so its param is the canonical {@link DownSessionState} and `error` reads with no
 *  cast. Inert for the warming/connected/copying tests (they never reach a down
 *  state, so this is never called there). */
const classify = (
  _h: string,
  _s: FakeSession,
  state: DownSessionState,
): TestFailure | null => ({ cause: "link-failed", reason: state.error });

/** Build a non-`connected` `SessionState` for the given `phase`. The DOWN arm
 *  (`disconnected`/`failed`) now REQUIRES a real `error` — the type no longer
 *  admits "down with no reason" — so this throws rather than silently defaulting
 *  one in, mirroring the production invariant at the test-helper boundary. Typed
 *  over `SshProv` so the ssh arm's provisioning phases (`copying`/`building`) are
 *  spellable here. `connected` is EXCLUDED — it now carries a `clockOffset`, so it
 *  is minted by {@link connected} below. */
const st = (
  phase: Exclude<SessionState<SshProv>["phase"], "connected">,
  error?: string,
): SessionState<SshProv> => {
  if (phase === "disconnected" || phase === "failed") {
    if (error === undefined) {
      throw new Error(`st(${phase}): a down arm requires an error`);
    }
    return {
      phase,
      log: [],
      error,
      cause: "remote",
      sinceMs: 0,
      campaignEpoch: 0,
    };
  }
  return { phase, log: [], sinceMs: 0, campaignEpoch: 0 };
};

/** A `connected` `SessionState` carrying the measured `clockOffset` — `null` until
 *  the admit `system.clockNow` probe stamps it. The offset now rides the connected
 *  arm itself (no separate `clockOffset()` session method, no injected `offsetOf`);
 *  `projectState` reads it straight off the state. */
const connected = (clockOffset: number | null): SessionState<SshProv> => ({
  phase: "connected",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
  clockOffset,
});

type FakeSession = Session;

/** `provisions` defaults `true` — the ssh arm (`Prov = SshProv`, the provisioning
 *  transport). Pass `false` to model a non-provisioning (local/endpoint) session —
 *  the runtime twin of `Prov = never`. */
function fakeSession(initial: SessionState<SshProv>, provisions = true) {
  let state = initial;
  const listeners = new Set<(s: SessionState<SshProv>) => void>();
  const session = {
    onState(cb: (s: SessionState<SshProv>) => void) {
      cb(state);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {},
    provisions,
  } as unknown as FakeSession;
  return {
    session,
    setState(next: SessionState<SshProv>) {
      state = next;
      for (const l of [...listeners]) l(next);
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
  it("maps each connection state; readiness is link-liveness, the offset rides through", () => {
    expect(projectState(st("copying"))).toEqual({ kind: "copying" });
    expect(projectState(st("connecting"))).toEqual({ kind: "connecting" });
    expect(projectState(connected(5))).toEqual({
      kind: "connected",
      clockOffset: 5,
    });
    // Connected but no offset yet → STILL `connected` (readiness is link-liveness, NOT
    // clock-measured). The null offset rides through as an honest "not-yet-measured"
    // fact — it does NOT demote the entry to `connecting`.
    expect(projectState(connected(null))).toEqual({
      kind: "connected",
      clockOffset: null,
    });
    // The RAW projection is domain-agnostic: the down arms carry NEITHER a domain
    // `failure` NOR a transport `reason` (lowy-1/lowy-2). `resolve` classifies the
    // down state into the schema-valid `failure` via `failureOf`, reading the
    // transport error off the `SessionState` there — it is not threaded onto the arm.
    expect(projectState(st("disconnected", "boom"))).toEqual({
      kind: "disconnected",
    });
    expect(projectState(st("failed", "dead"))).toEqual({ kind: "failed" });
    expect(projectState(undefined)).toEqual({ kind: "connecting" });
  });
});

describe("serveHostMap belt — a non-provisioning session can never project 'copying' (juspay/kolu#1716)", () => {
  it("RUNTIME pin: a PROVISIONING session in 'copying' projects 'copying' fine (the remote path warms-via-copy)", async () => {
    const p = fakePool();
    p.add("remote", fakeSession(st("copying"), true)); // provisions: true — legitimate
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
      failureOf: classify,
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
    p.add("local", fakeSession(st("copying"), false));
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
      failureOf: classify,
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
    p.add("local-a", fakeSession(st("copying"), false));
    p.add("local-b", fakeSession(st("copying"), false));
    const served = serveHostMap(map, p.pool, {
      linkFor: () => directLink<AnyContractRouter>({} as never),
      failureOf: classify,
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
      failureOf: classify,
    });
    const link = directLink<AnyContractRouter>(
      // biome-ignore lint/suspicious/noExplicitAny: served router
      served.router as any,
    );
    const s = fakeSession(st("connecting"));
    pf.add("a", s);

    const iter = await entriesGet(link, "a");
    // `toMatchObject` (not `toEqual`): a published `EntryStatus` also carries the
    // surface-map membership rider's opaque `membershipId`, orthogonal to the status
    // this test pins — assert the status shape, ignore that field.
    expect((await iter.next()).value).toMatchObject({ kind: "warming" }); // connecting → warming

    // A PURE status transition (no add/remove) must reach the entries stream.
    const pending = iter.next();
    s.setState(connected(42));
    expect((await pending).value).toMatchObject({
      kind: "connected",
      clockOffset: 42,
    });
    served.dispose();
  });

  it("membership add drives entries.keys()", async () => {
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      linkFor: () => ({ surface: {} }),
      failureOf: classify,
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
    pf.add("a", fakeSession(connected(0)));
    expect((await keysIter.next()).value).toEqual(["a"]);
    served.dispose();
  });
});

describe("serveHostMap — the fail-loud seam (PR4: no fabricated failure)", () => {
  it("throws UnclassifiedHostSessionError for a member with no session (the has()/getSession() race)", async () => {
    // A pool that reports a member but hands back no session — the unreachable-in-
    // steady-state race. A STATIC pool (subscribe never fires) so no background
    // republish runs; the throw surfaces through the client's `entries.get` read.
    const ghostPool = {
      hosts: () => ["ghost"],
      has: () => true,
      getSession: () => undefined,
      subscribe: () => () => {},
    } as unknown as ReturnType<typeof fakePool>["pool"];
    const served = serveHostMap(map, ghostPool, {
      linkFor: () => ({ surface: {} }),
      failureOf: classify,
    });
    const link = directLink<AnyContractRouter>(served.router as never);
    const iter = await entriesGet(link, "ghost");
    await expect(iter.next()).rejects.toThrow(UnclassifiedHostSessionError);
    served.dispose();
  });

  it("fails loud (out-of-band crash) when failureOf returns null for a terminal failed session", async () => {
    // A `failureOf` that declines to classify a terminal give-up is a producer defect:
    // the `failed` arm cannot exist without a schema-valid failure, so the republish
    // rethrows out-of-band (queueMicrotask) to crash the process rather than degrade to
    // a stale status. Detach vitest's own `uncaughtException` handlers for the window and
    // COLLECT every uncaught throw ourselves (one `add` drives two republishes — the
    // `onState` seed and the membership fire — so more than one crash queues), then
    // assert at least one is `UnclassifiedHostFailureError`. Collecting (not `once`)
    // keeps a second queued throw from leaking to vitest as a spurious suite failure.
    const priorHandlers = process.listeners("uncaughtException");
    for (const h of priorHandlers)
      process.removeListener("uncaughtException", h);
    const uncaught: unknown[] = [];
    const collect = (err: unknown): void => {
      uncaught.push(err);
    };
    process.on("uncaughtException", collect);
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      linkFor: () => ({ surface: {} }),
      failureOf: () => null, // declines to classify — the producer defect
    });
    try {
      pf.add("boom", fakeSession(st("failed", "gave up for good")));
      served.dispose();
      // Drain the queued microtask rethrows (and any macrotask straggler) before asserting.
      await new Promise((r) => setTimeout(r, 0));
      // The funnel rethrows a WRAPPER `Error` carrying the original as its `cause`.
      expect(
        uncaught.some(
          (e) =>
            e instanceof Error &&
            e.cause instanceof UnclassifiedHostFailureError,
        ),
      ).toBe(true);
    } finally {
      process.removeListener("uncaughtException", collect);
      for (const h of priorHandlers) process.on("uncaughtException", h);
    }
  });
});

describe("the joint connection-authority invariant (SR9, drishti#102)", () => {
  // THE LAW banked with SR9: for any `SessionState`, the entry's coarse dot
  // (`EntryStatus.kind === "connected"`) ⟺ its fine word
  // (`connection.phase === "connected"`). Before SR9 the word lived on a SEPARATE
  // `connection` cell (a second wire channel / subscription) that could latch out of
  // step with the dot — the drishti#102 divergence (green dot, permanent "connecting").
  // SR9 makes them ONE arm, produced by ONE per-frame projection from ONE `SessionState`,
  // so a half-updated dot/word pair has NO construction path. This test pins what that
  // construction guarantees; it also DRIVES the API (the entry must carry `connection`),
  // so it is RED until the fine payload rides the served `EntryStatus`.
  const cases: Array<{ name: string; state: SessionState<SshProv> }> = [
    { name: "connecting", state: st("connecting") },
    { name: "copying", state: st("copying") },
    { name: "building", state: st("building") },
    { name: "connected(measured)", state: connected(42) },
    { name: "connected(unmeasured)", state: connected(null) },
    { name: "disconnected", state: st("disconnected", "boom") },
    { name: "failed", state: st("failed", "dead") },
  ];

  for (const c of cases) {
    it(`${c.name}: dot-connected ⟺ word-connected (one arm, one frame)`, async () => {
      const pf = fakePool();
      const served = serveHostMap(map, pf.pool, {
        linkFor: () => ({ surface: {} }),
        failureOf: classify,
        connection,
      });
      const link = directLink<AnyContractRouter>(served.router as never);
      pf.add("h", fakeSession(c.state));
      const iter = await entriesGet(link, "h");
      const value = (await iter.next()).value as EntryStatus & {
        connection?: { phase?: string };
      };
      const dotConnected = value.kind === "connected";
      const wordConnected = value.connection?.phase === "connected";
      // The biconditional — the single fact the two views must never disagree on.
      expect(dotConnected).toBe(wordConnected);
      served.dispose();
    });
  }

  it("FAILS LOUD (never publishes) when the dot and word disagree — a divergent projection", async () => {
    // The invariant is enforced STRUCTURALLY at the producer: a `connection.project` that
    // contradicts the coarse dot (here it reports `connecting` for a genuinely `connected`
    // session) can never publish the half-updated pair — `resolve` throws before the entry
    // reaches the wire. This is what makes the drishti#102 divergence unconstructible-on-wire.
    // A STATIC pool (subscribe never fires) so the throw surfaces through the client's read,
    // not a background republish (which would fail loud out-of-band, as designed).
    const { session } = fakeSession(connected(42));
    const staticPool = {
      hosts: () => ["h"],
      has: (host: string) => host === "h",
      getSession: (host: string) => (host === "h" ? session : undefined),
      subscribe: () => () => {},
    } as unknown as ReturnType<typeof fakePool>["pool"];
    const served = serveHostMap(map, staticPool, {
      linkFor: () => ({ surface: {} }),
      failureOf: classify,
      connection: {
        project: () =>
          ({
            phase: "connecting",
            log: [],
            sinceMs: 0,
            campaignEpoch: 0,
          }) as ConnectionInfo,
        isConnected: (c) => c.phase === "connected",
      },
    });
    const link = directLink<AnyContractRouter>(served.router as never);
    const iter = await entriesGet(link, "h"); // dot → connected, word → connecting: a lie
    await expect(iter.next()).rejects.toThrow(ConnectionAuthorityMismatchError);
    served.dispose();
  });
});
