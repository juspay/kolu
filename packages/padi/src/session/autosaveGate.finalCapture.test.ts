/**
 * The SHUTDOWN EDGE — `captureFinalSession`.
 *
 * Continuous autosave is a leading-edge throttle, so the durable session trails
 * the live one by up to 500 ms. For a crash that is an irreducible bound; for an
 * ORDERLY stop it is an avoidable one, and until this edge existed padi's SIGTERM
 * path persisted nothing at all — it closed its socket, released its gate and
 * exited. The cross-epoch TAKEOVER load-bears on the opposite: the supervisor
 * signals the old padi precisely so its own shutdown runs, and the successor
 * seeds from what that shutdown left on disk.
 *
 * What this file pins is that the edge asks the gate rather than the writer: a
 * stop does not get to overrule the freeze lease or a pending restore, because
 * "is it safe to persist now, and with what value?" has exactly one owner.
 */

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
};

function wire(opts: {
  snapshot: () => SessionSnapshot;
  isRestorePending: () => boolean;
}): Wiring {
  const w: Wiring = { persisted: [], persistedFinal: [] };
  initAutosaveGate({
    snapshot: opts.snapshot,
    isRestorePending: opts.isRestorePending,
    persist: (s) => w.persisted.push(s),
    persistFinal: (s) => w.persistedFinal.push(s),
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
    // The shutdown write goes through `persistFinal`, never the debounced
    // `persist` — the two differ on the empty snapshot and a stop must preserve.
    expect(w.persistedFinal).toEqual([oneTerminal]);
    expect(w.persisted).toEqual([]);
  });

  it("REFUSES to write while a freeze lease is held", async () => {
    // A restart's capture→drain→park, or a `session.restore` spawn window. The
    // blob on disk is the pre-critical-section one — exactly what a restore
    // should read — and the live set is half-built. A stop does not overrule it.
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

    // …and once the LAST lease lifts, the edge writes normally again.
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

    // Arm the throttle, then stop before it fires.
    terminalsDirtyChannel.publish({});
    await tick(10);
    captureFinalSession("signal");
    expect(w.persistedFinal).toEqual([oneTerminal]);

    // Past the 500 ms window: the armed timer must NOT have fired, because a
    // fire during teardown observes a draining registry.
    await tick(700);
    expect(w.persisted).toEqual([]);
  });

  // LAST, because it re-evaluates the module to get an UNWIRED instance.
  it("THROWS when the gate was never wired — a boot-order defect, not a state", async () => {
    // Fail loud rather than silently dropping the last capture: reaching a
    // shutdown edge before the gate was wired is a boot-ORDER defect, and a
    // silent no-op there would look exactly like "there was nothing to save".
    vi.resetModules();
    const fresh = await import("./autosaveGate.ts");
    expect(() => fresh.captureFinalSession("signal")).toThrow(
      /autosave gate is not wired/,
    );
  });
});
