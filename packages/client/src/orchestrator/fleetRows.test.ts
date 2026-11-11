/** The fleet fold: membership minus the terminals that are gone, and both
 *  counts taken from the host's OWN attention frame rather than re-derived from
 *  a row's ranking bucket. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { fleetView, liveFleetIds } from "./fleetRows";

const id = (n: number): TerminalId =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111` as TerminalId;

const row = (n: number) => ({ id: id(n) });

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
    const view = fleetView([row(1), row(2), row(3)], [id(2)], [id(1), id(3)]);
    expect(view.working).toBe(2);
    expect(view.needsYou).toEqual([id(2)]);
  });

  it("counts working from the attention frame, not from the row order", () => {
    // The dock's ranking buckets decide ORDER; the attention class decides
    // colour and every count that summarises it. A row the host does not list
    // as working is not working, however it ranked.
    expect(fleetView([row(1), row(2)], [], [id(2)]).working).toBe(1);
  });

  it("takes needs-you from the host's asking list, never from a row", () => {
    expect(fleetView([row(1)], [], []).needsYou).toEqual([]);
  });

  it("ignores an awaiting terminal that is not in this fleet", () => {
    const view = fleetView([row(1)], [id(9)], []);
    expect(view.needsYou).toEqual([]);
  });
});
