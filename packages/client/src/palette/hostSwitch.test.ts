/** ⌘⇧H end to end, minus the DOM: the REAL host rows (`hostRootActions`) fed
 *  to the REAL default-highlight rule (`defaultSelectionIndex`), driven by the
 *  REAL trail (`useHostRecency` observing the active-host pref).
 *
 *  The two halves are unit-tested apart (`host/hostRecency.test.ts`,
 *  `palette/rootIndex.test.ts`); this pins the JOIN, which is where the feature
 *  would silently die — a row built without its `rankAt`, or ranked under a key
 *  the policy compares differently, leaves every isolated test green and lands
 *  ⌘⇧H back on row 1. The e2e harness is single-host, so this is the only
 *  automated place the host switcher's toggle can be exercised at all. */

import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({ setActive: (_h: HostKey) => {} }));

vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [active, setActive] = createSignal<HostKey>({ kind: "local" });
  bag.setActive = (h: HostKey) => setActive(h);
  return {
    activeHost: active,
    // Every pool host reads connected — the row's status text, not the rank.
    padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
  };
});

import { hostRootActions } from "./fleetActions";
import { defaultSelectionIndex } from "./rootIndex";

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };
// Membership order, which is the order the rows paint in — deliberately NOT
// the visit order, so a test that passes by accident of position can't.
const POOL = [LOCAL, GPU, BUILDER];

const enc = (h: HostKey): string =>
  h.kind === "local" ? "local" : `remote:${h.target}`;

/** The row ⌘⇧H would activate on Enter, given who is active now. */
function landsOn(active: HostKey, pool: HostKey[] = POOL): string | undefined {
  const rows = hostRootActions(pool, active, () => {});
  return rows[
    defaultSelectionIndex(rows, { hostKey: enc(active), terminalId: null })
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
    // The trail is shared across this file's cases, so this one states the
    // switches it depends on rather than assuming a clean slate.
    bag.setActive(BUILDER);
    bag.setActive(LOCAL);
    const NEVER: HostKey = { kind: "remote", target: "never-seen" };
    // NEVER leads the pool but has no trail entry; builder is the way back.
    // A position-based fallback would pick NEVER — the rank is what decides.
    expect(landsOn(LOCAL, [NEVER, GPU, BUILDER, LOCAL])).toBe("builder");
  });
});
