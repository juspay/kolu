import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSelectionIndex } from "./rootIndex";

const bag = vi.hoisted(() => ({ setActive: (_h: HostKey) => {} }));

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };
const POOL = [LOCAL, GPU, BUILDER];

type FleetActions = typeof import("./fleetActions");
let hostRootActions: FleetActions["hostRootActions"];

beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  vi.doMock("../wire", async () => {
    const { createSignal, createMemo, createRoot } = await import("solid-js");
    const [active, setActive] = createSignal<HostKey>({ kind: "local" });
    bag.setActive = (h: HostKey) => setActive(h);
    return {
      encActiveHost: createRoot(() =>
        createMemo(() => encodeHostKey(active())),
      ),
      padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
    };
  });
  ({ hostRootActions } = await import("./fleetActions"));
});

function landsOn(active: HostKey, pool: HostKey[] = POOL): string | undefined {
  const rows = hostRootActions(pool, active, () => {});
  return rows[
    defaultSelectionIndex(
      rows,
      { hostKey: encodeHostKey(active), terminalId: null },
      "",
    )
  ]?.name;
}

describe("⌘⇧H default highlight", () => {
  it("lands on the host you came from, so Enter toggles the last two", () => {
    bag.setActive(LOCAL);
    bag.setActive(GPU);
    expect(landsOn(GPU)).toBe("local");

    bag.setActive(BUILDER);
    expect(landsOn(BUILDER)).toBe("gpu-box");

    bag.setActive(GPU);
    expect(landsOn(GPU)).toBe("builder");
  });

  it("never lands on the active host (selecting it would be a no-op)", () => {
    bag.setActive(GPU);
    bag.setActive(LOCAL);
    expect(landsOn(LOCAL)).not.toBe("local");
  });

  it("ranks by the trail, not by pool position — a never-seen host loses", () => {
    bag.setActive(BUILDER);
    bag.setActive(LOCAL);
    const NEVER: HostKey = { kind: "remote", target: "never-seen" };
    expect(landsOn(LOCAL, [NEVER, GPU, BUILDER, LOCAL])).toBe("builder");
  });
});
