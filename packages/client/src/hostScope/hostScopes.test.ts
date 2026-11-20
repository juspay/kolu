import type { HostKey } from "kolu-common/hostKey";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("../wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "./mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

import { activeScope } from "./hostScopes";
import { addHost, resetHosts } from "./mockHostMap.testlib";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const HOST_A: HostKey = { kind: "remote", target: "A" };

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

beforeEach(() => {
  resetHosts();
  setDriveHost(HOST_A);
});

describe("hostScopes grounding seam (juspay/kolu#1763)", () => {
  it("boot window (active names A, membership empty) → activeScope is undefined and SILENT, then resolves once A joins — still silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await createRoot(async (dispose) => {
        try {
          setDriveHost(HOST_A);
          await flush();
          expect(activeScope()).toBeUndefined();
          expect(warn).not.toHaveBeenCalled();

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
