// @vitest-environment happy-dom
import { type HostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  host: { kind: "local" } as HostKey,
  writes: 0,
}));
vi.mock("../wire", () => ({
  activeHost: () => wire.host,
  setActiveHost: (next: HostKey) => {
    wire.writes += 1;
    wire.host = next;
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
  it("switches the host and leaves the conductor in one act", () => {
    toggleConductorMode();
    expect(conductorMode()).toBe(true);

    selectHostTab(ZEST);
    expect(wire.host).toBe(ZEST);
    expect(conductorMode()).toBe(false);
  });

  it("does not re-write an already-active host, but still leaves", () => {
    selectHostTab(ZEST);
    const writesAfterSwitch = wire.writes;
    toggleConductorMode();

    selectHostTab({ kind: "remote", target: "srid@zest" });
    expect(conductorMode()).toBe(false);
    expect(wire.writes).toBe(writesAfterSwitch);
  });
});

describe("the ⌘⇧O round trip", () => {
  it("returns to the host tab that was active, not to the default", () => {
    selectHostTab(ZEST);

    toggleConductorMode();
    expect(conductorMode()).toBe(true);
    expect(wire.host).toBe(ZEST);
    const writesWhileReading = wire.writes;

    toggleConductorMode();
    expect(conductorMode()).toBe(false);
    expect(wire.host).toBe(ZEST);
    expect(wire.writes).toBe(writesWhileReading);
  });
});
