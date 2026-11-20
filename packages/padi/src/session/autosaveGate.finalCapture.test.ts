import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureFinalSession,
  cancelPendingAutosave,
  freezeAutosave,
  initAutosaveGate,
  unfreezeAutosave,
} from "./autosaveGate.ts";
import type { SessionSnapshot } from "./session.ts";
import { terminalsDirtyChannel } from "../publisher.ts";

const tick = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const oneTerminal: SessionSnapshot = {
  terminals: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "t",
      cwd: "/tmp",
    } as unknown as SessionSnapshot["terminals"][number],
  ],
  activeTerminalId: null,
};

type Wiring = {
  persisted: SessionSnapshot[];
  persistedFinal: SessionSnapshot[];
  activeIds: string[];
};

function wire(opts: {
  snapshot: () => SessionSnapshot;
  isRestorePending: () => boolean;
}): Wiring {
  const w: Wiring = { persisted: [], persistedFinal: [], activeIds: [] };
  initAutosaveGate({
    snapshot: opts.snapshot,
    isRestorePending: opts.isRestorePending,
    orphanedParkedIds: () => [],
    persist: (s) => w.persisted.push(s),
    persistFinal: (s) => w.persistedFinal.push(s),
    persistActiveId: (id) => w.activeIds.push(id),
  });
  return w;
}

beforeEach(() => {
  cancelPendingAutosave();
  unfreezeAutosave();
});

describe("captureFinalSession", () => {
  it("persists the LIVE snapshot through the empty-preserve receptacle", async () => {
    const w = wire({
      snapshot: () => oneTerminal,
      isRestorePending: () => false,
    });
    await tick(10);

    expect(captureFinalSession("signal")).toEqual({ kind: "persist" });
    expect(w.persistedFinal).toEqual([oneTerminal]);
    expect(w.persisted).toEqual([]);
  });

  it("REFUSES to write while a freeze lease is held", async () => {
    const w = wire({
      snapshot: () => oneTerminal,
      isRestorePending: () => false,
    });
    await tick(10);

    const lease = freezeAutosave("restart capture");
    const decision = captureFinalSession("signal");
    expect(decision.kind).toBe("frozen");
    if (decision.kind !== "frozen") throw new Error("unreachable");
    expect(decision.reason).toContain("restart capture");
    expect(w.persistedFinal).toEqual([]);

    unfreezeAutosave(lease);
    expect(captureFinalSession("signal").kind).toBe("persist");
    expect(w.persistedFinal).toEqual([oneTerminal]);
  });

  it("REFUSES to write while a restore is pending (parked entries stand in)", async () => {
    const w = wire({
      snapshot: () => oneTerminal,
      isRestorePending: () => true,
    });
    await tick(10);

    expect(captureFinalSession("signal").kind).toBe("suppressed-parked");
    expect(w.persistedFinal).toEqual([]);
  });

  it("DISARMS the pending autosave, so no throttled fire lands mid-teardown", async () => {
    const w = wire({
      snapshot: () => oneTerminal,
      isRestorePending: () => false,
    });
    await tick(10);

    terminalsDirtyChannel.publish({});
    await tick(10);
    captureFinalSession("signal");
    expect(w.persistedFinal).toEqual([oneTerminal]);

    await tick(700);
    expect(w.persisted).toEqual([]);
  });

  it("THROWS when the gate was never wired — a boot-order defect, not a state", async () => {
    vi.resetModules();
    const fresh = await import("./autosaveGate.ts");
    expect(() => fresh.captureFinalSession("signal")).toThrow(
      /autosave gate is not wired/,
    );
  });
});
