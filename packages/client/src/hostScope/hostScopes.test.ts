/** The grounding SEAM (juspay/kolu#1763) — the CLIENT-level regression that pins the
 *  load-bearing production wiring at `hostScopes.ts`: the per-host `scopedByEntry`
 *  owner is fed `wire.groundedActiveHost` (the per-tab active host GROUNDED against
 *  membership), NEVER the raw `wire.activeHost`. If that one 2nd-arg regressed back to
 *  the raw accessor, the BOOT WINDOW — active restored SYNC from sessionStorage a tick
 *  before the async `entries` snapshot lands — would hand `scopedByEntry` an active key
 *  membership does not ground and trip its removal-race dev-warn (a boot false positive,
 *  the whole bug). This asserts the boot window reads as the no-selection inhabitant
 *  (`activeScope()` undefined, and SILENT — grounded=`null`, not a non-member) and then
 *  resolves once membership arrives, still silent.
 *
 *  Division of labour: the pure grounding decision table lives in
 *  `host/groundActive.test.ts`; the surface-map inhabitants it composes (a `null`
 *  accessor is silent, a non-member active warns) in `surface-map/scoped.test.ts`
 *  case (5). This file is the ONLY place that pins kolu WIRES the former into the
 *  latter — falsifiable because the raw accessor and the grounded one DIVERGE in the
 *  boot window (raw=A trips the warn; grounded=null does not).
 *
 *  Same real-owner fixture as `perHostViewState.test.ts` — a REAL `scopedByEntry` over
 *  the shared mock `padiMap` (`mockHostMap.testlib`) with `groundedActiveHost` the
 *  shared testlib composition production uses — but here the active host and membership
 *  are driven SEPARATELY, because the boot window is exactly active-without-membership. */

import type { HostKey } from "kolu-common/hostKey";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `./wire` mock stands up the mock `padiMap` the real owner reads, the per-tab
// `activeHost` signal, and — the seam under test — `groundedActiveHost`, the shared
// testlib composition (`activeHost` grounded against this mock's membership).
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("../wire", async () => {
  const { mockPadiMap, mockPadiRpcOf, mockGroundedActiveHost } = await import(
    "./mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    padiRpcOf: mockPadiRpcOf(vi.fn(async () => {})),
    activeHost: () => bag.activeHost(),
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

import { activeScope } from "./hostScopes";
import { addHost, resetHosts } from "./mockHostMap.testlib";

/** Solid flushes membership/keying effects on a microtask; a macrotask drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A remote host so encode-equality (not the trivial `local`) does the grounding. */
const HOST_A: HostKey = { kind: "remote", target: "A" };

// Module-level STABLE active-host signal (the app-lifetime owner tracks it ONCE).
const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

beforeEach(() => {
  // Empty membership FIRST — disposes the prior test's per-host owners — then reset
  // the active host to A (named, but not yet a member: the boot window).
  resetHosts();
  setDriveHost(HOST_A);
});

describe("hostScopes grounding seam (juspay/kolu#1763)", () => {
  it("boot window (active names A, membership empty) → activeScope is undefined and SILENT, then resolves once A joins — still silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await createRoot(async (dispose) => {
        try {
          // BOOT: active restored sync from sessionStorage (A) a tick before the
          // `entries` snapshot lands. Grounded against empty membership → `null` →
          // the no-selection inhabitant. Handing the RAW `activeHost` (A) here would
          // trip `scopedByEntry`'s non-member removal-race warn — the #1763 bug.
          setDriveHost(HOST_A);
          await flush();
          expect(activeScope()).toBeUndefined();
          expect(warn).not.toHaveBeenCalled();

          // The `entries` snapshot lands with A → grounded=A → the scope resolves,
          // still silent (a member activation is never a removal race).
          addHost(HOST_A);
          await flush();
          expect(activeScope()).toBeDefined();
          expect(warn).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      });
    } finally {
      warn.mockRestore();
    }
  });
});
