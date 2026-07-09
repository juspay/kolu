/** Per-host VIEW POSTURE + dock filters + right-panel bit (padi W7 TIER A) — the
 *  acceptance suite for the four view facts moved INTO the per-host `scopedByEntry`
 *  owner (`hostScope/createViewState`): the fullscreen posture (`canvasMaximized`),
 *  the two dock filters (`activityWindow`, `showSleeping`), and the right-panel
 *  collapsed bit. Each follows the maximized pattern: SET on host A → switch to
 *  host B sees the DEFAULT → switch BACK to A sees A's value RESTORED (the owner is
 *  RETAINED across a switch-away, disposed only on membership exit). For the two
 *  PERSISTED dock filters it also asserts the PER-HOST localStorage key is written
 *  (`kolu-activityWindow:<host>` / `kolu-showSleeping:<host>`) — the trade that buys
 *  reload-survival back after they lost their single global key.
 *
 *  Same real-owner fixture as `perHostCanvas.test.ts`: a REAL `scopedByEntry` over
 *  the shared mock `padiMap` (`hostScope/mockHostMap.testlib`), membership driven by
 *  `addHost`/`resetHosts` and the active host by one module-stable signal. Unlike
 *  perHostCanvas, `./persistedPref` is NOT mocked here — the filters write happy-dom's
 *  real `localStorage`, so the per-host key assertion is falsifiable (`beforeEach`
 *  clears it for isolation). */

import type { HostKey } from "kolu-common/hostKey";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `./wire` mock stands up the mock `padiMap` the real owner reads + the per-tab
// `activeHost` signal that drives its per-host keying. `padiRpcOf` is only touched by
// `writeActive` (unused here) but must import cleanly.
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("./wire", async () => {
  const { mockPadiMap } = await import("./hostScope/mockHostMap.testlib");
  return {
    padiMap: mockPadiMap,
    padiRpcOf: () => ({
      surface: { chrome: { setActive: vi.fn(async () => {}) } },
    }),
    activeHost: () => bag.activeHost(),
  };
});

import { activeScope } from "./hostScope/hostScopes";
import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import {
  activityWindow,
  setActivityWindow,
} from "./terminal/activityWindowFilter";
import { setShowSleeping, showSleeping } from "./terminal/showSleeping";
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

describe("per-host view posture + dock filters (W7 TIER A)", () => {
  it("canvasMaximized: set on A → B sees tiled (default) → back to A restores maximized", async () => {
    await createRoot(async (dispose) => {
      try {
        const view = useViewState();

        switchTo(HOST_A);
        await flush();
        expect(view.canvasMaximized()).toBe(false);
        view.toggleCanvasMaximized();
        expect(view.canvasMaximized()).toBe(true);

        switchTo(HOST_B);
        await flush();
        // B's fresh owner defaults to tiled — A's posture does not bleed across.
        expect(view.canvasMaximized()).toBe(false);

        switchTo(HOST_A);
        await flush();
        // A's owner was retained across the switch-away — its posture is restored.
        expect(view.canvasMaximized()).toBe(true);
      } finally {
        dispose();
      }
    });
  });

  it("activityWindow: set on A → B sees 24h (default) → back to A restores 4h, and A's per-host key is written", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        expect(activityWindow()).toBe("24h");
        setActivityWindow("4h");
        expect(activityWindow()).toBe("4h");
        await flush();
        // The trade: persisted PER HOST so a host's filter survives reload.
        expect(localStorage.getItem("kolu-activityWindow:local")).toBe("4h");

        switchTo(HOST_B);
        await flush();
        expect(activityWindow()).toBe("24h");

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

  it("rightPanelCollapsed: set on A → B sees inherit (undefined default) → back to A restores the override", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        // `undefined` = "inherit the global pref"; the facade seeds the read from it.
        expect(activeScope()?.view.rightPanelCollapsed()).toBeUndefined();
        activeScope()?.view.setRightPanelCollapsed(true);
        expect(activeScope()?.view.rightPanelCollapsed()).toBe(true);

        switchTo(HOST_B);
        await flush();
        expect(activeScope()?.view.rightPanelCollapsed()).toBeUndefined();

        switchTo(HOST_A);
        await flush();
        expect(activeScope()?.view.rightPanelCollapsed()).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
