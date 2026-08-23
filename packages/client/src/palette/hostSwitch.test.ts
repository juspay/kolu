/** ⌘⇧H end to end, minus the DOM: the REAL host rows (`hostRootActions`) fed
 *  to the REAL default-highlight rule (`defaultSelectionIndex`), driven by the
 *  REAL trail (`hostRecency` observing the active-host pref).
 *
 *  The two halves are unit-tested apart (`host/hostRecency.test.ts`,
 *  `palette/rootIndex.test.ts`); this pins the JOIN, which is where the feature
 *  would silently die — a row built without its `visitedAt`, or highlighted
 *  under the warmth key instead of the visit key, leaves every isolated test
 *  green and lands ⌘⇧H back on row 1. The e2e harness is single-host, so this is
 *  the only automated place the host switcher's toggle can be exercised at all. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSelectionIndex } from "./rootIndex";

const bag = vi.hoisted(() => ({ setActive: (_h: HostKey) => {} }));

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };
// Membership order, which is the order the rows paint in — deliberately NOT
// the visit order, so a test that passes by accident of position can't.
const POOL = [LOCAL, GPU, BUILDER];

type FleetActions = typeof import("./fleetActions");
let hostRootActions: FleetActions["hostRootActions"];

// A FRESH trail per case, without giving up the real composition: reset the
// module registry so `hostRecency`'s app-lifetime root is rebuilt, wipe the tab
// storage it reads, and re-register the `../wire` stand-in. The mock is a
// `doMock` inside the reset, not a hoisted `vi.mock`: a hoisted factory's result
// is cached across `resetModules`, so its `activeHost` signal would belong to
// the PREVIOUS `solid-js` instance and the rebuilt trail's effect would never
// track it — the trail would record its boot host and nothing after.
beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  vi.doMock("../wire", async () => {
    const { createSignal, createMemo, createRoot } = await import("solid-js");
    const [active, setActive] = createSignal<HostKey>({ kind: "local" });
    bag.setActive = (h: HostKey) => setActive(h);
    return {
      // The trail keys on the ENCODED memo, as wire.ts exposes it.
      encActiveHost: createRoot(() =>
        createMemo(() => encodeHostKey(active())),
      ),
      // Every pool host reads connected — the row's status text, not the rank.
      padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
    };
  });
  ({ hostRootActions } = await import("./fleetActions"));
});

/** The row ⌘⇧H would activate on Enter, given who is active now. */
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
    // local → gpu-box: the way back is local, which is also row 1 here…
    expect(landsOn(GPU)).toBe("local");

    bag.setActive(BUILDER);
    // …now gpu-box is the way back, and it is NOT row 1 — the trail decides.
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
    // NEVER leads the pool but has no trail entry; builder is the way back.
    // A position-based fallback would pick NEVER — the rank is what decides.
    expect(landsOn(LOCAL, [NEVER, GPU, BUILDER, LOCAL])).toBe("builder");
  });
});
