import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
    activePadiRpc: { chrome: { setSubPanel: () => Effect.void } },
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

import { attentionRecordOf } from "./attention/savedAttention";
import { activeScope, hostScopeOf } from "./hostScope/hostScopes";
import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import {
  activityWindow,
  setActivityWindow,
} from "./terminal/activityWindowFilter";
import { setShowSleeping, showSleeping } from "./terminal/showSleeping";
import { useSubPanel } from "./terminal/useSubPanel";
import { useViewState } from "./useViewState";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

beforeEach(() => {
  resetHosts();
  setDriveHost(HOST_A);
  localStorage.clear();
});

describe("per-host view posture + dock filters (W7 TIER A)", () => {
  it("canvasMaximized: set on A → B sees tiled (default) → back to A restores maximized, and A's per-host key is written", async () => {
    await createRoot(async (dispose) => {
      try {
        const view = useViewState();

        switchTo(HOST_A);
        await flush();
        expect(view.canvasMaximized()).toBe(false);
        view.toggleCanvasMaximized();
        expect(view.canvasMaximized()).toBe(true);
        await flush();
        expect(localStorage.getItem("kolu-canvasMaximized:local")).toBe("true");

        switchTo(HOST_B);
        await flush();
        expect(view.canvasMaximized()).toBe(false);

        switchTo(HOST_A);
        await flush();
        expect(view.canvasMaximized()).toBe(true);
      } finally {
        dispose();
      }
    });
  });

  it("canvasMaximized: survives a reload — a FRESH owner reads back the persisted posture (the W7-regression repro)", async () => {
    localStorage.setItem("kolu-canvasMaximized:local", "true");
    await createRoot(async (dispose) => {
      try {
        const view = useViewState();
        switchTo(HOST_A);
        await flush();
        expect(view.canvasMaximized()).toBe(true);
      } finally {
        dispose();
      }
    });
  });

  it("activityWindow: set on A → B sees all (default) → back to A restores 4h, and A's per-host key is written", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        expect(activityWindow()).toBe("all");
        setActivityWindow("4h");
        expect(activityWindow()).toBe("4h");
        await flush();
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
        useSubPanel().focusMainPane("term-1" as TerminalId);
        vs.reconcileLiveIds(["term-1", "term-2"] as TerminalId[]);
        attentionRecordOf("local").markUnread("term-1" as TerminalId);
        vs.setCanvasMaximized(true);
        expect(vs.activeId()).not.toBeNull();
        expect(vs.mruOrder().length).toBeGreaterThan(0);
        expect(vs.isUnread("term-1" as TerminalId)).toBe(true);
        expect(vs.canvasMaximized()).toBe(true);
        vs.reset();
        expect(vs.activeId()).toBeNull();
        expect(vs.mruOrder()).toEqual([]);
        expect(vs.isUnread("term-1" as TerminalId)).toBe(false);
        expect(vs.canvasMaximized()).toBe(false);
      } finally {
        dispose();
      }
    });
  });

  it("the engine's episode end clears the mark without focusing — on a host you are NOT viewing", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        await flush();
        const a = activeScope()?.view;
        if (!a) throw new Error("no active view for HOST_A");
        attentionRecordOf("local").markUnread("term-1" as TerminalId);
        expect(a.isUnread("term-1" as TerminalId)).toBe(true);

        switchTo(HOST_B);
        await flush();
        const retained = hostScopeOf(HOST_A)?.view;
        if (!retained) throw new Error("HOST_A's owner was not retained");
        expect(retained.isUnread("term-1" as TerminalId)).toBe(true);

        attentionRecordOf("local").clearUnread("term-1" as TerminalId);
        expect(retained.isUnread("term-1" as TerminalId)).toBe(false);
        expect(retained.focusedTerminalId()).toBeNull();
      } finally {
        dispose();
      }
    });
  });
});
