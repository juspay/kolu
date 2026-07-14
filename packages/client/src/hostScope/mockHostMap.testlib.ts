/** Test helper — a synchronous, signal-backed mock `padiMap` for unit tests that
 *  exercise the per-host `scopedByEntry` owner (`hostScopes`) through the hooks
 *  that window onto it (`useViewState`, `useSessionRestore`, `createHostWire`).
 *
 *  `scopedByEntry` reads only `client.entries.use().keys()` + `client.codec.encode`,
 *  so those two are the whole real surface it needs; `useEntry`/`live`/`dispose` stay
 *  unused stubs. `entry(host)` is INSTRUMENTED (W9): it hands back per-host cell /
 *  collection stubs whose `.use()` records an open + registers an `onCleanup`, so
 *  `createHostWire`'s retained subscriptions have a lifecycle a test can read via
 *  {@link wireLifecycle} — proving they open once per host, survive switch-away, and
 *  dispose only on membership exit. Membership is a plain `createSignal` (the
 *  code-under-test's OWN solid instance — the client vitest config inlines `solid-js`,
 *  so the owner's membership memo actually tracks it) driven with {@link addHost} /
 *  {@link removeHost} / {@link resetHosts}.
 *
 *  Use it from a test's `vi.mock("./wire", …)` factory (`padiMap: mockPadiMap`) and
 *  call {@link resetHosts} in `beforeEach`: emptying membership DISPOSES the prior
 *  test's per-host owners (membership exit), so each test gets FRESH owners
 *  (lazy-again-after-re-add) — the isolation a module-level cached owner otherwise
 *  can't give. `.testlib.ts` is test-only: dropped from the build fileset and not
 *  matched by the vitest `*.test.ts` include. */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { groundActiveHost } from "../host/groundActive";

// Encoded host strings — the membership set the owner's disposal authority reads.
const [members, setMembers] = createSignal<string[]>([]);

/** Open / dispose tallies for ONE host's retained wire subscriptions. `opened`
 *  counts `entry(host).<member>.use()` calls (a build opens each once); `disposed`
 *  counts their `onCleanup` firings (a membership-exit owner teardown). */
export interface WireLifecycle {
  opened: number;
  disposed: number;
}
const wireLog = new Map<string, WireLifecycle>();

/** The lifecycle tally for `host` — created on first read. Assert `opened === 1`
 *  after an A→B→A switch (retained, not rebuilt) and `disposed === opened` after
 *  the host leaves membership (disposed with its owner). */
export function wireLifecycle(host: HostKey): WireLifecycle {
  const k = encodeHostKey(host);
  let e = wireLog.get(k);
  if (!e) {
    e = { opened: 0, disposed: 0 };
    wireLog.set(k, e);
  }
  return e;
}

/** Clear the wire-lifecycle tallies — call in `beforeEach` so each test counts
 *  fresh opens/disposes rather than the prior test's accumulated total. */
export function resetWireLog(): void {
  wireLog.clear();
}

/** A stubbed cell/collection subscription, instrumented for lifecycle. Called
 *  during `createHostWire`, i.e. INSIDE the host's `scopedByEntry` owner, so its
 *  `onCleanup` counts a real membership-exit teardown. Carries the tiny read
 *  surface `createHostWire`'s consumers touch (`byKey`/`value`/`pending`/…), all
 *  benign no-ops — this fixture pins the retention lifecycle, not wire values. */
function instrumentedSub(hostKey: string): Record<string, unknown> {
  wireLifecycle(decodeHostKey(hostKey)).opened++;
  onCleanup(() => {
    wireLifecycle(decodeHostKey(hostKey)).disposed++;
  });
  return {
    byKey: () => undefined,
    value: () => undefined,
    sub: () => () => {},
    pending: () => true,
    error: () => undefined,
    complete: () => false,
    keys: () => [],
  };
}

/** The mock `padiMap` (a minimal `SurfaceMapClient`) — assign it to the `./wire`
 *  mock's `padiMap` export. */
export const mockPadiMap = {
  entries: {
    use: () => ({
      keys: () => members().map(decodeHostKey),
      byKey: () => undefined,
    }),
  },
  codec: { encode: encodeHostKey, decode: decodeHostKey },
  live: () => true,
  // Instrumented point lens — `createHostWire` opens the host's retained cells +
  // collections through `entry(host)`, so each `.use()` records its lifecycle.
  entry: (host: HostKey) => {
    const k = encodeHostKey(host);
    const cell = { use: () => instrumentedSub(k) };
    // The `terminals` collection also exposes the un-enrolled keys-stream ref
    // `createHostWire` now reaches (`entry.collections.terminals.unenrolledKeys`,
    // fed to `unenrolledStreamCall`) — a no-op async iterable, like the old
    // `mockPadiRpcOf`'s `terminals.keys` stub it replaces.
    const collection = {
      use: () => instrumentedSub(k),
      unenrolledKeys: () => emptyAsyncIterable(),
    };
    return {
      cells: { session: cell, activityFeed: cell },
      collections: { terminals: collection, daemonStatus: collection },
    };
  },
  useEntry: () => {
    throw new Error("mockPadiMap: useEntry() is unused by scopedByEntry");
  },
  dispose: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: a minimal SurfaceMapClient stub — scopedByEntry touches entries + codec; entry() is the instrumented per-host lens
} as any;

/** The GROUNDED active-host accessor the per-host scope reads (juspay/kolu#1763) —
 *  mirrors production's `wire.groundedActiveHost` (`groundActiveHost` composed against
 *  live membership) over THIS mock's membership: the active host IFF a member, else
 *  null (so an emptied `resetHosts` disposes the owner with no removal-race warn). The
 *  composition lives HERE so a wiring-shape change lands once, not in every `vi.mock`
 *  factory. Pass the test's `activeHost` accessor (or `() => LOCAL_HOST` for a static
 *  single-host test). */
export const mockGroundedActiveHost = (active: Accessor<HostKey>) => () =>
  groundActiveHost(active(), mockPadiMap.entries.use().keys());

/** The `padiRpcOf(host)` stub the per-host tests share — now the entry's BOUND
 *  PROCEDURES face (`padiRpcOf = padiMap.entry(host).procedures`), so its one wired
 *  member is `chrome.setActive` (where `createViewState`'s `writeActive` reports the
 *  active tile) — no `.surface` prefix, and no `terminals.keys` (the un-enrolled keys
 *  stream moved onto the entry's collections face, stubbed in {@link mockPadiMap}'s
 *  `entry().collections.terminals.unenrolledKeys`). Pass the per-test `setActive`
 *  spy; the shape lives HERE so a `padiRpcOf` contract change lands once, not in
 *  every `vi.mock` factory. (`activePadiRpc` is NOT shared — its wired procedure
 *  members genuinely differ per test, so each factory stubs its own.) */
export const mockPadiRpcOf =
  (setActive: (...args: never[]) => unknown) => () => ({
    chrome: { setActive },
  });

/** An async iterable that completes immediately (yields nothing) — the mock
 *  `terminals.keys` stream `createHostWire` opens through `unenrolledStreamCall`. */
async function* emptyAsyncIterable(): AsyncGenerator<never> {
  // Intentionally empty: completes at once, so the keys subscription settles
  // without yielding — the retention test asserts lifecycle, not carried ids.
}

/** Add a host to `entries` (idempotent) — a switch's ADD-AS-MEMBER half. */
export function addHost(host: HostKey): void {
  const k = encodeHostKey(host);
  setMembers((m) => (m.includes(k) ? m : [...m, k]));
}

/** Remove ONE host from `entries` — a single-host membership exit (its owner, and
 *  every retained subscription in it, disposes) while other hosts stay put. */
export function removeHost(host: HostKey): void {
  const k = encodeHostKey(host);
  setMembers((m) => m.filter((x) => x !== k));
}

/** Empty `entries` — disposes every per-host owner (membership exit). Call it in
 *  `beforeEach` for clean per-test isolation. */
export function resetHosts(): void {
  setMembers([]);
}
