/**
 * Pins the serve-time empty seed — the guard that used to live three times, once
 * per attention consumer, and now lives once at the producer.
 *
 * The second pin is the one an inlined boolean loses: this is not "ignore empty
 * frames". Once a real fleet has been seen, an empty map means every terminal
 * exited, and every consumer must be told.
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { createFleetGate } from "./fleetGate.ts";

/** A frame of N terminals — the gate reads only the SIZE, so the records need
 *  not be real ones. */
const frame = (n: number): ReadonlyMap<TerminalId, PadiTerminal> =>
  new Map(
    Array.from({ length: n }, (_, i) => [
      `t${i}` as TerminalId,
      {} as PadiTerminal,
    ]),
  );

describe("createFleetGate", () => {
  it("refuses the pre-adopt frame — padi's registry before kaval was adopted", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(0))).toBe(false);
    // The reactor may re-run the fold before anything is adopted; every one of
    // those frames is the same non-evidence.
    expect(gate.admit(frame(0))).toBe(false);
  });

  it("opens on the first REAL inventory", () => {
    const gate = createFleetGate();
    gate.admit(frame(0));
    expect(gate.admit(frame(2))).toBe(true);
  });

  it("STAYS open — an empty fleet after a real one is every terminal exiting", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(1))).toBe(true);
    // The whole reason this is a gate and not an is-empty test: a supervisor
    // whose last worker just exited must be told, and a `gone` event for it is
    // exactly what the settle detector produces from this frame.
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("admits a first frame that is already populated — a daemon that adopted before serving", () => {
    expect(createFleetGate().admit(frame(3))).toBe(true);
  });
});
