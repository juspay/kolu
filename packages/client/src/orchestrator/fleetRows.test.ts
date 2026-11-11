/** The fleet fold: membership minus the terminals that are gone, and the
 *  needs-you list taken from the host's OWN awaiting set rather than
 *  re-derived from the rows. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { fleetView, liveFleetIds } from "./fleetRows";

const id = (n: number): TerminalId =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111` as TerminalId;

const row = (n: number, bucket: string, asking: boolean) => ({
  id: id(n),
  bucket,
  asking,
});

describe("liveFleetIds", () => {
  it("drops a member whose terminal record is gone", () => {
    const fleet = [id(1), id(2), id(3)];
    expect(liveFleetIds(fleet, (t) => t !== id(2))).toEqual([id(1), id(3)]);
  });

  it("keeps padi's order", () => {
    const fleet = [id(3), id(1)];
    expect(liveFleetIds(fleet, () => true)).toEqual([id(3), id(1)]);
  });
});

describe("fleetView", () => {
  it("counts the working rows and lists the blocked ones in row order", () => {
    const view = fleetView(
      [
        row(1, "working", false),
        row(2, "awaiting", true),
        row(3, "working", false),
      ],
      [id(2)],
    );
    expect(view.working).toBe(2);
    expect(view.needsYou).toEqual([id(2)]);
  });

  it("takes needs-you from the urgency list, not from the row's own flag", () => {
    // A row that paints `asking` but is not in the host's awaiting set does not
    // invent a needs-you entry — one authority decides who is blocked.
    const view = fleetView([row(1, "awaiting", true)], []);
    expect(view.needsYou).toEqual([]);
  });

  it("ignores an awaiting terminal that is not in this fleet", () => {
    const view = fleetView([row(1, "working", false)], [id(9)]);
    expect(view.needsYou).toEqual([]);
  });
});
