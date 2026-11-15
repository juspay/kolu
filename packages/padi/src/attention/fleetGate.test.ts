/**
 * Pins the serve-time empty seed — the guard that used to live three times, once
 * per attention consumer, and now lives once at the producer — and the fact it
 * PUBLISHES, since the consumer it cost most was across a wire (#2376).
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

  it("ESTABLISHES an empty roster when the boot says adoption finished", () => {
    // The case a frame can never open: a host whose session really is empty.
    // Until the boot said so, "nothing listed" was not evidence; after it, an
    // empty roster is a complete census and a member missing from it is gone.
    const gate = createFleetGate();
    expect(gate.admit(frame(0))).toBe(false);
    gate.establish();
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("CLOSES again for a recycle's drain window, and re-opens at the re-park", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(2))).toBe(true);
    // `killAllTerminals` empties the registry on purpose; nothing missing from
    // it is a terminal that died.
    gate.settling();
    expect(gate.admit(frame(0))).toBe(false);
    gate.establish();
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("publishes each CHANGE of the standing, with the epoch it was established", () => {
    const seen: unknown[] = [];
    const gate = createFleetGate({
      publish: (roster) => seen.push(roster),
      now: () => 1_700_000_000_000,
    });
    expect(gate.roster()).toEqual({ kind: "settling" });
    gate.admit(frame(0));
    gate.admit(frame(1));
    // Idempotent: a second establish (the boot landing after a frame already
    // opened the gate) republishes nothing.
    gate.establish();
    gate.settling();
    expect(seen).toEqual([
      { kind: "established", at: 1_700_000_000_000 },
      { kind: "settling" },
    ]);
    expect(gate.roster()).toEqual({ kind: "settling" });
  });
});
