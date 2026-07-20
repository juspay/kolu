/** Pins the #1763 boot-stalled copy authority — a sibling of `hostDownCopy.test.ts`.
 *  The `satisfies Record<StalledLeg, …>` in `bootStalledCopy.ts` already fails the build
 *  if a leg is missing; this asserts every leg's copy is non-empty and distinct so the
 *  card never renders a blank or a duplicated message. */

import { describe, expect, it } from "vitest";
import type { StalledLeg } from "./canvasModeResolver";
import {
  BOOT_STALLED_COPY,
  bootStalledCopy,
  bootStalledPhaseDetail,
} from "./bootStalledCopy";

const ALL_LEGS: StalledLeg[] = [
  "provisioning",
  "membership",
  "session",
  "daemon",
  "unknown",
];

describe("bootStalledCopy", () => {
  it("has non-empty title + body for every stalled leg", () => {
    for (const leg of ALL_LEGS) {
      const copy = bootStalledCopy(leg);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the known legs (no orphan keys, none missing)", () => {
    expect(new Set(Object.keys(BOOT_STALLED_COPY))).toEqual(new Set(ALL_LEGS));
  });

  it("`unknown` gets its OWN honest copy — not the session leg's wording (R5)", () => {
    expect(bootStalledCopy("unknown")).not.toEqual(bootStalledCopy("session"));
  });

  it("each leg's title is distinct — no leg silently reuses another's card", () => {
    const titles = ALL_LEGS.map((leg) => bootStalledCopy(leg).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("bootStalledPhaseDetail", () => {
  it("names the two provisioning phases with distinct, non-empty detail lines", () => {
    const copying = bootStalledPhaseDetail("copying");
    const building = bootStalledPhaseDetail("building");
    expect(copying).toBeTruthy();
    expect(building).toBeTruthy();
    expect(copying).not.toEqual(building);
  });

  it("has no detail for the handshake phases or the pre-frame gap", () => {
    for (const phase of ["probing", "connecting", undefined] as const) {
      expect(bootStalledPhaseDetail(phase)).toBeUndefined();
    }
  });
});
