import type { HostKey } from "kolu-common/hostKey";
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
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
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
  resetWireLog();
});

describe("per-host wire subscriptions (padi W9 — instant host switch-back)", () => {
  it("opens a host's wire subs LAZILY on first activation — a member you never visit costs nothing", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).opened).toBe(5);

        addHost(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(0);

        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(5);
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
        expect(wireLifecycle(HOST_A).opened).toBe(5);

        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_B).opened).toBe(5);
        expect(wireLifecycle(HOST_A).opened).toBe(5);
        expect(wireLifecycle(HOST_A).disposed).toBe(0);

        switchTo(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).opened).toBe(5);
        expect(wireLifecycle(HOST_A).disposed).toBe(0);
      } finally {
        dispose();
      }
    });
  });

  it("DISPOSES a host's wire subs only when it leaves membership", async () => {
    await createRoot(async (dispose) => {
      try {
        switchTo(HOST_A);
        void activeScope();
        await flush();
        switchTo(HOST_B);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).disposed).toBe(0);

        removeHost(HOST_A);
        void activeScope();
        await flush();
        expect(wireLifecycle(HOST_A).disposed).toBe(5);
        expect(wireLifecycle(HOST_B).disposed).toBe(0);
      } finally {
        dispose();
      }
    });
  });
});
