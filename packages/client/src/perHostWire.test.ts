/** Per-host WIRE SUBSCRIPTIONS retained across switch-away (padi W9 — completing
 *  W7's K1). The acceptance suite for the five per-host readouts (`terminalKeys`,
 *  the `terminals` collection, saved session, activity feed, daemon status) moved
 *  OUT of `wire.ts`'s `useEntry(activeHost)` block and INTO the retained
 *  `scopedByEntry` owner via `hostScope/createHostWire`.
 *
 *  The pin: a host's wire subscriptions are opened LAZILY on first activation,
 *  RETAINED across every switch-away (NOT torn down and reopened from pending —
 *  the ~1s canvas-rebuild W9 removes), and DISPOSED only when the host leaves
 *  `padiMap.entries`. If a future edit regresses these back onto `useEntry`
 *  (dispose-on-key-change), the "opened stays 1 across A→B→A" assertion fails —
 *  the structural guard that switch-back has no resubscribe, so no pending window
 *  can exist.
 *
 *  Same real-owner fixture as `perHostViewState.test.ts`: a REAL `scopedByEntry`
 *  over the shared mock `padiMap` (`hostScope/mockHostMap.testlib`), membership
 *  driven by `addHost`/`removeHost`/`resetHosts` and the active host by one
 *  module-stable signal. The mock's `entry(host)` is instrumented so each retained
 *  cell/collection `.use()` records an open + an `onCleanup`, giving the lifecycle
 *  the assertions below read via `wireLifecycle`. */

import type { HostKey } from "kolu-common/hostKey";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `./wire` mock stands up the mock `padiMap` (with the instrumented `entry`)
// the real owner reads, the `padiRpcOf` stub `createHostWire`'s keys stream opens,
// and the per-tab `activeHost` signal that drives per-host keying.
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("./wire", async () => {
  const { mockPadiMap, mockPadiRpcOf } = await import(
    "./hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    padiRpcOf: mockPadiRpcOf(vi.fn(async () => {})),
    activeHost: () => bag.activeHost(),
  };
});

import { activeScope } from "./hostScope/hostScopes";
import {
  addHost,
  removeHost,
  resetHosts,
  resetWireLog,
  wireLifecycle,
} from "./hostScope/mockHostMap.testlib";

/** Solid flushes membership/keying (and the keyArray render effect that builds an
 *  owner) on a microtask; a macrotask drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

// Module-level STABLE active-host signal (the app-lifetime owner tracks it ONCE).
const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

/** A real host switch: ADD the target as a member and make it active, in one
 *  batch — the owner builds (first activation) or re-keys `activeScope()` to it. */
function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

beforeEach(() => {
  // Empty membership FIRST — disposes the prior test's per-host owners — then reset
  // the active host and the lifecycle tallies for clean per-test isolation.
  resetHosts();
  setDriveHost(HOST_A);
  resetWireLog();
});

describe("per-host wire subscriptions (padi W9 — instant host switch-back)", () => {
  it("opens a host's wire subs LAZILY on first activation — a member you never visit costs nothing", async () => {
    await createRoot(async (dispose) => {
      try {
        // Visit A (the default active host): its owner builds, opening its subs.
        // `createHostWire` opens FOUR subs through the instrumented `entry(host)`
        // (terminals, session, activityFeed, daemonStatus); the fifth, terminalKeys,
        // rides `createReactiveSubscription` and is not counted here.
        switchTo(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).opened).toBe(4);

        // Add B as a MEMBER but never make it active: a background host you have not
        // visited gets no owner and opens NO subscriptions (the lazy cost floor).
        addHost(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(0);

        // Only on first activation does B's owner build → its wire subs open, once.
        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(4);
        expect(wireLifecycle(HOST_B).disposed).toBe(0);
      } finally {
        dispose();
      }
    });
  });

  it("RETAINS a host's wire subs across a switch-away and back — NO resubscribe (the pending-window fix)", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).opened).toBe(4);

        // Switch AWAY to B: B builds its own subs; A is RETAINED (not disposed).
        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(4);
        expect(wireLifecycle(HOST_A).opened).toBe(4);
        expect(wireLifecycle(HOST_A).disposed).toBe(0);

        // Switch BACK to A: its owner was retained, so it is NOT rebuilt — `opened`
        // stays 4 (a `useEntry` regression would reopen it, making this 8). This is
        // the structural proof that switch-back has no pending window.
        switchTo(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).opened).toBe(4);
        expect(wireLifecycle(HOST_A).disposed).toBe(0);
      } finally {
        dispose();
      }
    });
  });

  it("RETAINS the daemon pending-window anchor across switch-away, and re-anchors ONLY on a genuine re-add (the wedged-host ceiling still fires)", async () => {
    // A distinct, monotonic `Date.now()` per call so each scope birth stamps a
    // unique anchor — retention shows as an UNCHANGED value across a switch, a
    // re-add as a NEW one, both deterministically.
    let tick = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => ++tick);
    try {
      await createRoot(async (dispose) => {
        try {
          switchTo(HOST_A);
          void activeScope();
          await flush();
          const anchorA1 = activeScope()?.wire.daemonPendingAnchorMs;
          expect(anchorA1).toBeTypeOf("number");

          // Switch AWAY to B and BACK to A: A's scope is retained, so its anchor is
          // NOT re-stamped — a switch-back does NOT restart the "kaval didn't start"
          // clock (the sub isn't re-subscribing either). A per-switch re-anchor would
          // let a repeatedly-revisited wedged host dodge the timeout forever.
          switchTo(HOST_B);
          void activeScope();
          await flush();
          switchTo(HOST_A);
          void activeScope();
          await flush();
          expect(activeScope()?.wire.daemonPendingAnchorMs).toBe(anchorA1);

          // A genuine re-add (A left membership, then came back) is a NEW pending run
          // — a fresh anchor, so the re-added host gets its own full grace period.
          removeHost(HOST_A);
          void activeScope();
          await flush();
          switchTo(HOST_A);
          void activeScope();
          await flush();
          expect(activeScope()?.wire.daemonPendingAnchorMs).not.toBe(anchorA1);
        } finally {
          dispose();
        }
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("DISPOSES a host's wire subs only when it leaves membership", async () => {
    await createRoot(async (dispose) => {
      try {
        // Visit A then B so both have live retained owners.
        switchTo(HOST_A);
        void activeScope();
        await flush();
        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).disposed).toBe(0);

        // A leaves the pool (e.g. the user ✕'d its chip) while B stays active: A's
        // owner — and every retained subscription in it — disposes; B is untouched.
        removeHost(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).disposed).toBe(4);
        expect(wireLifecycle(HOST_B).disposed).toBe(0);
      } finally {
        dispose();
      }
    });
  });
});
