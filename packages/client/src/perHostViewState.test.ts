/** Per-host dock filters (padi W7 TIER A) — the acceptance suite for the
 *  per-host `scopedByEntry` owner: the selection facts in
 *  `hostScope/createViewState`, and the two dock filters (`activityWindow`, `showSleeping`) in the sibling `hostScope/createHostPrefs`
 *  (the sticky prefs a close-all must NOT clear). (The right-panel collapsed bit is
 *  neither — it's per-TERMINAL, on `TerminalMetadata.rightPanel`, so the panel follows the terminal, #959.)
 *  Each follows the same pattern: SET on host A → switch to
 *  host B sees the DEFAULT → switch BACK to A sees A's value RESTORED (the owner is
 *  RETAINED across a switch-away, disposed only on membership exit). All three are
 *  PERSISTED per host, so each also asserts its PER-HOST localStorage key is written
 *  (`kolu-activityWindow:<host>` / `kolu-showSleeping:<host>`)
 *  — the trade that buys reload-survival while keeping each host's value isolated.
 *
 *  Same real-owner fixture as `perHostCanvas.test.ts`: a REAL `scopedByEntry` over
 *  the shared mock `padiMap` (`hostScope/mockHostMap.testlib`), membership driven by
 *  `addHost`/`resetHosts` and the active host by one module-stable signal. Unlike
 *  perHostCanvas, `./persistedPref` is NOT mocked here — the filters write happy-dom's
 *  real `localStorage`, so the per-host key assertion is falsifiable (`beforeEach`
 *  clears it for isolation). */

import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `./wire` mock stands up the mock `padiMap` the real owner reads + the per-tab
// `activeHost` signal that drives its per-host keying. `writeActive`'s active-tile
// report rides the shared map's `entry().procedures.chrome.setActive` (a no-op here).
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("./wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "./hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    // The GROUNDED accessor the per-host scope reads — the shared testlib composition.
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

import { activeScope } from "./hostScope/hostScopes";
import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import {
  activityWindow,
  setActivityWindow,
} from "./terminal/activityWindowFilter";
import { setShowSleeping, showSleeping } from "./terminal/showSleeping";
import { useTileFocus } from "./terminal/useTileFocus";
import { useViewState } from "./useViewState";

/** Solid flushes membership/keying effects on a microtask; a macrotask drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The two hosts a switch moves between — `encodeHostKey` maps them to distinct
 *  record + storage keys ("local" vs "remote:B"). */
const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

// Module-level STABLE active-host signal (the app-lifetime owner tracks it ONCE).
const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

/** A real host switch: ADD the target as a member (add-as-member) and make it
 *  active, in one batch — the owner re-keys `activeScope()` to the target's owner. */
function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

beforeEach(() => {
  // Empty membership FIRST — disposes the prior test's per-host owners — then reset
  // the active host and the persisted filter storage for clean isolation.
  resetHosts();
  setDriveHost(HOST_A);
  localStorage.clear();
});

describe("per-host dock filters (W7 TIER A)", () => {

  it("activityWindow: set on A → B sees all (default) → back to A restores 4h, and A's per-host key is written", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        expect(activityWindow()).toBe("all");
        setActivityWindow("4h");
        expect(activityWindow()).toBe("4h");
        await flush();
        // The trade: persisted PER HOST so a host's filter survives reload.
        expect(localStorage.getItem("kolu-activityWindow:local")).toBe("4h");

        switchTo(HOST_B);
        await flush();
        expect(activityWindow()).toBe("all");

        switchTo(HOST_A);
        await flush();
        expect(activityWindow()).toBe("4h");
      } finally {
        dispose();
      }
    });
  });

  it("showSleeping: set on A → B sees shown (default) → back to A restores hidden, and A's per-host key is written", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        expect(showSleeping()).toBe(true);
        setShowSleeping(false);
        expect(showSleeping()).toBe(false);
        await flush();
        expect(localStorage.getItem("kolu-showSleeping:local")).toBe("false");

        switchTo(HOST_B);
        await flush();
        expect(showSleeping()).toBe(true);

        switchTo(HOST_A);
        await flush();
        expect(showSleeping()).toBe(false);
      } finally {
        dispose();
      }
    });
  });

  it("reset() clears EVERY reset-on-close-all fact (completeness — a forgotten field fails HERE)", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        const vs = activeScope()?.view;
        if (!vs) throw new Error("no active view for HOST_A");
        // Mutate EVERY reset-on-close-all fact this factory owns.
        useTileFocus().focusTerminal("term-1" as TerminalId);
        vs.reconcileLiveIds(["term-1", "term-2"] as TerminalId[]);
        vs.markUnread("term-1" as TerminalId);
        // Sanity: all three facts are non-default.
        expect(vs.activeId()).not.toBeNull();
        expect(vs.mruOrder().length).toBeGreaterThan(0);
        expect(vs.isUnread("term-1" as TerminalId)).toBe(true);
        // reset() must return EVERY fact to its default. A future reset-on-close-all
        // fact added to this factory but FORGOTTEN in reset() fails this assertion —
        // the completeness guard for the hand-enumerated reset (perfection review).
        vs.reset();
        expect(vs.activeId()).toBeNull();
        expect(vs.mruOrder()).toEqual([]);
        expect(vs.isUnread("term-1" as TerminalId)).toBe(false);
      } finally {
        dispose();
      }
    });
  });
});
