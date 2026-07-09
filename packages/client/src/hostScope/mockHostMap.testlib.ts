/** Test helper — a synchronous, signal-backed mock `padiMap` for unit tests that
 *  exercise the per-host `scopedByEntry` owner (`hostScopes`) through the hooks
 *  that window onto it (`useViewState`, `useSessionRestore`).
 *
 *  `scopedByEntry` reads only `client.entries.use().keys()` + `client.codec.encode`,
 *  so those two are the whole real surface here; `entry`/`useEntry`/`live`/`dispose`
 *  are unused stubs. Membership is a plain `createSignal` (the code-under-test's OWN
 *  solid instance — the client vitest config inlines `solid-js`, so the owner's
 *  membership memo actually tracks it) driven with {@link addHost}/{@link resetHosts}.
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
import { createSignal } from "solid-js";

// Encoded host strings — the membership set the owner's disposal authority reads.
const [members, setMembers] = createSignal<string[]>([]);

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
  entry: () => {
    throw new Error("mockPadiMap: entry() is unused by scopedByEntry");
  },
  useEntry: () => {
    throw new Error("mockPadiMap: useEntry() is unused by scopedByEntry");
  },
  dispose: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: a minimal SurfaceMapClient stub — scopedByEntry only touches entries + codec
} as any;

/** The `padiRpcOf(host)` stub the three per-host tests share — a partial padi RPC
 *  whose ONE wired member is `surface.chrome.setActive` (where `createViewState`'s
 *  `writeActive` reports the active tile). Pass the per-test `setActive` spy; the
 *  shape lives HERE so a `padiRpcOf` contract change lands once, not in three
 *  `vi.mock` factories. (`activePadiRpc` is NOT shared — its wired surface members
 *  genuinely differ per test, so each factory stubs its own.) */
export const mockPadiRpcOf =
  (setActive: (...args: never[]) => unknown) => () => ({
    surface: { chrome: { setActive } },
  });

/** Add a host to `entries` (idempotent) — a switch's ADD-AS-MEMBER half. */
export function addHost(host: HostKey): void {
  const k = encodeHostKey(host);
  setMembers((m) => (m.includes(k) ? m : [...m, k]));
}

/** Empty `entries` — disposes every per-host owner (membership exit). Call it in
 *  `beforeEach` for clean per-test isolation. */
export function resetHosts(): void {
  setMembers([]);
}
