// @vitest-environment happy-dom
/**
 * The tab row has two halves — the conductor's tab first, then the host tabs —
 * and this pins the trip between them.
 *
 * `⌘⇧O` is a ROUND TRIP: it shows the conversation and the next press puts you
 * back on the host tab you were on, not on the local default and not on
 * whichever host something else touched meanwhile. That holds because the two
 * halves are separate values: selecting the conductor never writes a host
 * key, and `selectHostTab` never writes anything but one.
 */

import { type HostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  host: { kind: "local" } as HostKey,
  writes: 0,
}));
// A stand-in for the real signal setter: `selectHostTab` guards the switch
// with the UPDATER form (it must not read `activeHost`, which would be a
// strict-read at its effect call sites), so the mock applies the updater and
// counts only the writes that actually CHANGE the value — an equal write
// notifies nobody, which is the guard the tests below pin.
vi.mock("../wire", () => ({
  setActiveHost: (next: HostKey | ((prev: HostKey) => HostKey)) => {
    const value = typeof next === "function" ? next(wire.host) : next;
    if (value === wire.host) return;
    wire.writes += 1;
    wire.host = value;
  },
}));

import {
  exitConductorMode,
  conductorMode,
  toggleConductorMode,
} from "../conductor/useConductorMode";
import { selectHostTab } from "./selectHostTab";

const ZEST: HostKey = { kind: "remote", target: "srid@zest" };

beforeEach(() => {
  wire.host = LOCAL_HOST;
  wire.writes = 0;
  exitConductorMode();
});

describe("selectHostTab", () => {
  // `conductorMode` is a signal: each command's write is staged, so every
  // reading below is taken after the flush its caller's frame would have.
  it("switches the host and leaves the conductor in one act", () => {
    toggleConductorMode();
    flush();
    expect(conductorMode()).toBe(true);

    selectHostTab(ZEST);
    flush();
    expect(wire.host).toBe(ZEST);
    expect(conductorMode()).toBe(false);
  });

  it("does not re-write an already-active host, but still leaves", () => {
    selectHostTab(ZEST);
    const writesAfterSwitch = wire.writes;
    toggleConductorMode();
    flush();

    // Clicking the tab you are already on, while reading the chat, is how a
    // person asks to go back to it — a no-op would strand them.
    selectHostTab({ kind: "remote", target: "srid@zest" });
    flush();
    expect(conductorMode()).toBe(false);
    expect(wire.writes).toBe(writesAfterSwitch);
  });
});

describe("the ⌘⇧O round trip", () => {
  it("returns to the host tab that was active, not to the default", () => {
    selectHostTab(ZEST);

    toggleConductorMode();
    flush();
    expect(conductorMode()).toBe(true);
    // Showing the conversation touches no host at all.
    expect(wire.host).toBe(ZEST);
    const writesWhileReading = wire.writes;

    toggleConductorMode();
    flush();
    expect(conductorMode()).toBe(false);
    expect(wire.host).toBe(ZEST);
    expect(wire.writes).toBe(writesWhileReading);
  });
});
